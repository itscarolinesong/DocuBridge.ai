import Tesseract from 'tesseract.js';
import { EMRData } from '@/types/medical';

// Fuzzy string matching using Levenshtein distance
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(s1: string, s2: string): number {
  const costs: number[] = [];
  for (let i = 0; i <= s2.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s1.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(j - 1) !== s2.charAt(i - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s1.length] = lastValue;
  }
  return costs[s1.length];
}

// Normalize text for better matching
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}

// Field name variants for fuzzy matching
const fieldVariants = {
  patientName: {
    variants: [
    'patient name', 'name', 'full name', 'pt name', 'patient', 
    'name of patient', 'patient full name', 'legal name'
  ],
    pattern: /patient ?(?! id):? (\w+( +\w+)*)(?= age)/i
  },
  patientId: [
    'mrn', 'patient id', 'id', 'medical record number', 'record number',
    'patient number', 'chart number', 'account number', 'record no',
    'medical record no', 'pt id', 'patient mrn'
  ],
  dateOfBirth: [
    'dob', 'date of birth', 'birth date', 'birthdate', 'born',
    'date birth', 'patient dob', 'pt dob', 'birthday'
  ],
  diagnosis: [
    'diagnosis', 'assessment', 'impression', 'dx', 'diagnoses',
    'primary diagnosis', 'clinical impression', 'findings'
  ]
};

// Find the best matching field label
function findBestMatch(text: string, variants: string[], threshold: number = 0.6): boolean {
  const normalized = normalizeText(text);
  
  // Check for exact matches first
  for (const variant of variants) {
    const normalizedVariant = normalizeText(variant);
    if (normalized === normalizedVariant) {
      return true;
    }
  }
  
  // Check for substring matches
  for (const variant of variants) {
    const normalizedVariant = normalizeText(variant);
    if (normalized.includes(normalizedVariant) || normalizedVariant.includes(normalized)) {
      return true;
    }
  }
  
  // Fuzzy matching for typos and OCR errors
  for (const variant of variants) {
    if (similarity(normalized, normalizeText(variant)) >= threshold) {
      return true;
    }
  }
  
  return false;
}

// Extract field value using multiple strategies
function extractField(rawText: string, fieldVariants: string[], pattern: string): string | null {
  const lines = rawText.split('\n');
  const candidates: Array<{value: string, confidence: number, lineNumber: number}> = [];
  
  console.log(`\nLooking for field variants: ${fieldVariants.join(', ')}`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    console.log(`Processing line ${i}: "${line}"`);

    // Strategy 0: match custom pattern directly
    // extract items from cleanValue
    const patMatch = line.match(pattern);
    if (patMatch) {
      const [,extracted] = patMatch;
      console.log("strategy 0: " + extracted); 
      candidates.push({
        value: extracted,
        confidence: 1,
        lineNumber: i
      });
    }
    
    // Strategy 1: Direct colon separation (Field: Value)
    const colonMatch = line.match(/^(.+?)[:]\s*(.*)$/);
    if (colonMatch) {
      const [, label, value] = colonMatch;
      const cleanLabel = label.trim();
      const cleanValue = value.trim();
      
      console.log(`  Strategy 1: Colon match - Label: "${cleanLabel}", Value: "${cleanValue}"`);
      
      // Check if this is a good field match
      for (const variant of fieldVariants) {
        const matchScore = similarity(normalizeText(cleanLabel), normalizeText(variant));
        if (matchScore >= 0.6 || normalizeText(cleanLabel).includes(normalizeText(variant))) {
          console.log(`  ✓ Found match variant ${variant} for "${cleanLabel}" (score: ${matchScore}) with value "${cleanValue}"`);
          
          if (cleanValue && cleanValue.length > 0) {
            // extract items from cleanValue
            const patMatch = cleanValue.match(pattern);
            console.log('patMatch: ' + patMatch);
            if (patMatch) {
              const [,extracted] = patMatch;
              console.log("this is " + extracted); 
            }

            // Higher confidence for exact colon-separated format
            candidates.push({
              value: cleanValue,
              confidence: matchScore + 0.3, // Boost colon format
              lineNumber: i
            });
          } else if (i + 1 < lines.length) {
            // Check next line for value
            const nextLine = lines[i + 1].trim();
            if (nextLine && !nextLine.includes(':') && nextLine.length > 1) {
              console.log(`  ✓ Using next line value: "${nextLine}"`);
              candidates.push({
                value: nextLine,
                confidence: matchScore + 0.2,
                lineNumber: i
              });
            }
          }
          break; // Found a match for this variant, move to next line
        }
      }
    }
    
    // Strategy 2: Look for field name at start of line, value after
    console.log('Strategy 2');
    const words = line.split(/\s+/);
    for (let wordCount = 1; wordCount <= Math.min(4, words.length); wordCount++) {
      const potentialLabel = words.slice(0, wordCount).join(' ');
      
      // Check match quality for each variant
      for (const variant of fieldVariants) {
        const matchScore = similarity(normalizeText(potentialLabel), normalizeText(variant));
        if (matchScore >= 0.7 || normalizeText(potentialLabel).includes(normalizeText(variant))) {
          console.log(`  ✓ Word match found for "${potentialLabel}" (score: ${matchScore})`);
          
          // Get remaining words as value
          const remainingWords = words.slice(wordCount);
          if (remainingWords.length > 0) {
            const value = remainingWords.join(' ').replace(/^[:：\-\s]+/, '').trim();
            if (value && value.length > 1) {
              console.log(`  ✓ Same line value: "${value}"`);
              candidates.push({
                value: value,
                confidence: matchScore,
                lineNumber: i
              });
            }
          } else if (i + 1 < lines.length) {
            // Check next line for value
            const nextLine = lines[i + 1].trim();
            if (nextLine && !nextLine.includes(':') && nextLine.length > 1) {
              console.log(`  ✓ Next line value: "${nextLine}"`);
              candidates.push({
                value: nextLine,
                confidence: matchScore - 0.1, // Slightly lower confidence for next-line format
                lineNumber: i
              });
            }
          }
          break; // Found a match for this variant
        }
      }
    }
  }
  
  // Return the candidate with highest confidence
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.confidence - a.confidence);
    console.log(`  ✓ Best candidate: "${candidates[0].value}" (confidence: ${candidates[0].confidence}, line: ${candidates[0].lineNumber})`);
    return candidates[0].value;
  }
  
  console.log(`  ✗ No match found for field variants`);
  return null;
}

export async function extractTextFromImage(file: File): Promise<string> {
  const { data: { text } } = await Tesseract.recognize(file, 'eng', {
    logger: (m) => console.log('OCR Progress:', m.progress),
  });
  return text;
}

export function parseEMRText(rawText: string): EMRData {
  console.log('Raw text to parse:\n', rawText);
  console.log('\n=== Starting field extraction ===');
  
  // Clean up common OCR artifacts
  const cleanedText = rawText
    .replace(/\|/g, 'I') // Common OCR mistake: | instead of I
    .replace(/[O0]/g, (match, offset) => {
      // Context-aware O/0 correction
      const before = rawText[offset - 1];
      const after = rawText[offset + 1];
      if (/\d/.test(before) || /\d/.test(after)) return '0';
      return 'O';
    });
    
  // Extract each field with improved logic
  const patientName = extractField(cleanedText, fieldVariants.patientName.variants, fieldVariants.patientName.pattern) || 'Unknown';
  // const patientId = extractField(cleanedText, fieldVariants.patientId) || 'N/A';
  // const dateOfBirth = extractField(cleanedText, fieldVariants.dateOfBirth) || 'N/A';
  // const diagnosis = extractField(cleanedText, fieldVariants.diagnosis) || 'N/A';

  console.log('\n=== Final extracted fields ===');
  console.log('Patient Name:', patientName);
  // console.log('Patient ID:', patientId);
  // console.log('Date of Birth:', dateOfBirth);
  // console.log('Diagnosis:', diagnosis);

  return {
    patientName,
    patientId: '',
    dateOfBirth: '',
    diagnosis: '',
    medications: extractMedications(cleanedText),
    labResults: extractLabResults(cleanedText),
    rawText: cleanedText,
  };
}

function extractMedications(text: string): string[] {
  // Multiple possible section headers
  const medHeaders = ['medications', 'meds', 'current medications', 'rx', 'prescriptions', 'drug list', 'medicines'];
  
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  let inMedSection = false;
  const medications: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this line is a medication section header
    if (findBestMatch(line, medHeaders, 0.5)) {
      inMedSection = true;
      continue;
    }
    
    // Stop if we hit another major section
    if (inMedSection && line.match(/^(lab|diagnosis|assessment|history|physical|plan|vital|allergies)[\s:]/i)) {
      break;
    }
    
    // Collect medication lines
    if (inMedSection && line.length > 0) {
      // Clean up bullet points and numbering
      const cleaned = line.replace(/^[-•*\d+.)\]]\s*/, '').trim();
      if (cleaned.length > 2 && !cleaned.match(/^[A-Za-z\s]+[:：]/)) {
        medications.push(cleaned);
      }
    }
  }
  
  return medications;
}

function extractLabResults(text: string): string[] {
  const labHeaders = ['lab results', 'labs', 'laboratory', 'lab values', 'test results', 'laboratory results', 'blood work'];
  
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  let inLabSection = false;
  const labResults: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (findBestMatch(line, labHeaders, 0.5)) {
      inLabSection = true;
      continue;
    }
    
    if (inLabSection && line.match(/^(medications|diagnosis|assessment|history|plan|vital|allergies)[\s:]/i)) {
      break;
    }
    
    if (inLabSection && line.length > 0) {
      const cleaned = line.replace(/^[-•*\d+.)\]]\s*/, '').trim();
      if (cleaned.length > 2 && !cleaned.match(/^[A-Za-z\s]+[:：]/)) {
        labResults.push(cleaned);
      }
    }
  }
  
  return labResults;
}

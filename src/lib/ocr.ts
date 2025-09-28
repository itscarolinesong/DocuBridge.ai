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
  patientName: [
    'patient name', 'name', 'full name', 'pt name', 'Patient', 
    'name of patient', 'patient full name', 'legal name'
  ],
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
function findBestMatch(text: string, variants: string[], threshold: number = 0.5): boolean {
  const normalized = normalizeText(text);
  
  // Check for exact matches first
  if (variants.some(v => normalized === normalizeText(v))) {
    return true;
  }
  
  // Check for substring matches
  if (variants.some(v => normalized.includes(normalizeText(v)) || normalizeText(v).includes(normalized))) {
    return true;
  }
  
  // Fuzzy matching for typos and OCR errors
  return variants.some(v => similarity(normalized, normalizeText(v)) >= threshold);
}

// Extract field value using multiple strategies
function extractField(
  rawText: string, 
  fieldVariants: string[], 
  contextClues?: string[]
): string | null {
  const lines = rawText.split('\n');

  // for (let i = 0; i < lines.length; i++) {
  //   const line = lines[i];
  //   const words = line.split(/[\s:]+/);
  //   for (let j = 0; j < words.length; j++) {
  //     if (findBestMatch(words.slice(0, j + 1).join(' '), fieldVariants)) {
  //       const value = words.slice(j + 1).join(' ').trim();
  //       if (value && value.length > 0) {
  //         return value;
  //       }
        
  //       // Strategy 2: Value might be on next line
  //       if (i + 1 < lines.length) {
  //         const nextLine = lines[i + 1].trim();
  //         if (nextLine && nextLine.length > 0 && !nextLine.match(/^[A-Z][a-z]+:/)) {
  //           return nextLine;
  //         }
  //       }
  //     }
  //   }

    
  //   // Strategy 3: Look for field with colon separator
  //   const colonMatch = line.match(/^(.+?)[:：]\s*(.+)$/);
  //   if (colonMatch) {
  //     const [, label, value] = colonMatch;
  //     if (findBestMatch(label, fieldVariants) && value.trim()) {
  //       return value.trim();
  //     }
  //   }
  // }
  
  // Strategy 4: Context-based extraction (for fields without clear labels)
  // if (contextClues) {
  //   for (const line of lines) {
  //     if (contextClues.some(clue => normalizeText(line).includes(normalizeText(clue)))) {
  //       const value = line.replace(new RegExp(contextClues.join('|'), 'gi'), '').trim();
  //       if (value) return value;
  //     }
  //   }
  // }
  
  // return null;


  const results: string[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const words = line.split(/[\s:]+/);

  for (let j = 0; j < words.length; j++) {
    if (findBestMatch(words.slice(0, j + 1).join(' '), fieldVariants)) {
      const value = words.slice(j + 1).join(' ').trim();
      if (value && value.length > 0) {
        results.push(value);
        break; // move to next line
      }

      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && nextLine.length > 0 && !nextLine.match(/^[A-Z][a-z]+:/)) {
          results.push(nextLine);
          break; // move to next line
        }
      }
    }
  }

  const colonMatch = line.match(/^(.+?)[:：]\s*(.+)$/);
  if (colonMatch) {
    const [, label, value] = colonMatch;
    if (findBestMatch(label, fieldVariants) && value.trim()) {
      results.push(value.trim());
      parseEMRText(value.trim());
    }
  }
}

return null; // return all matches after loop finishes

}


export async function extractTextFromImage(file: File): Promise<string> {
  const { data: { text } } = await Tesseract.recognize(file, 'eng', {
    logger: (m) => console.log('OCR Progress:', m.progress),
  });
  return text;
}

export function parseEMRText(rawText: string): EMRData {
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
  const patientName = extractField(cleanedText, fieldVariants.patientName) || 'Unknown';
  const patientId = extractField(cleanedText, fieldVariants.patientId) || 'N/A';
  const dateOfBirth = extractField(cleanedText, fieldVariants.dateOfBirth) || 'N/A';
  const diagnosis = extractField(cleanedText, fieldVariants.diagnosis) || 'N/A';


  return {
    patientName,
    patientId,
    dateOfBirth,
    diagnosis,
    medications: extractMedications(cleanedText),
    labResults: extractLabResults(cleanedText),
    rawText: cleanedText,
  };
}

function extractMedications(text: string): string[] {
  // Multiple possible section headers
  const medHeaders = ['medications', 'meds', 'current medications', 'rx', 'prescriptions', 'drug list'];
  
  const lines = text.split('\n');
  let inMedSection = false;
  const medications: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if this line is a medication section header
    if (findBestMatch(line, medHeaders, 0.5)) {
      inMedSection = true;
      continue;
    }
    
    // Stop if we hit another section
    if (inMedSection && line.match(/^(lab|diagnosis|assessment|history|physical|plan)[\s:]/i)) {
      break;
    }
    
    // Collect medication lines
    if (inMedSection && line.length > 0) {
      // Clean up bullet points and numbering
      const cleaned = line.replace(/^[-•*\d+.)\]]\s*/, '').trim();
      if (cleaned.length > 2) {
        medications.push(cleaned);
      }
    }
  }
  
  return medications;
}

function extractLabResults(text: string): string[] {
  const labHeaders = ['lab results', 'labs', 'laboratory', 'lab values', 'test results', 'laboratory results'];
  
  const lines = text.split('\n');
  let inLabSection = false;
  const labResults: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (findBestMatch(line, labHeaders, 0.5)) {
      inLabSection = true;
      continue;
    }
    
    if (inLabSection && line.match(/^(medications|diagnosis|assessment|history|plan)[\s:]/i)) {
      break;
    }
    
    if (inLabSection && line.length > 0) {
      const cleaned = line.replace(/^[-•*\d+.)\]]\s*/, '').trim();
      if (cleaned.length > 2) {
        labResults.push(cleaned);
      }
    }
  }
  
  return labResults;
}
import Tesseract, { Word } from 'tesseract.js';
import { EMRData } from '@/types/medical';

// Extended types for OCR data
interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface EnhancedWord extends Word {
  bbox: BoundingBox;
  confidence: number;
  text: string;
}

interface EnhancedLine {
  bbox: BoundingBox;
  confidence: number;
  text: string;
  words: EnhancedWord[];
}

// Type for global OCR data storage
interface GlobalOCRData {
  text: string;
  confidence: number;
  lines: EnhancedLine[];
  words: EnhancedWord[];
  blocks: unknown[];
}

// Extend globalThis to include our OCR data
declare global {
  // eslint-disable-next-line no-var
  var __ocrData: GlobalOCRData | undefined;
}

// Image preprocessing functions
async function preprocessImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          canvas.width = img.width;
          canvas.height = img.height;

          // Draw original image
          ctx.drawImage(img, 0, 0);

          // Get image data
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          // Step 1: Convert to grayscale
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
          }

          // Step 2: Enhance contrast using histogram equalization
          const histogram = new Array(256).fill(0);
          for (let i = 0; i < data.length; i += 4) {
            histogram[data[i]]++;
          }

          const cdf = new Array(256).fill(0);
          cdf[0] = histogram[0];
          for (let i = 1; i < 256; i++) {
            cdf[i] = cdf[i - 1] + histogram[i];
          }

          const cdfMin = cdf.find(val => val > 0) || 0;
          const totalPixels = canvas.width * canvas.height;

          for (let i = 0; i < data.length; i += 4) {
            const oldValue = data[i];
            const newValue = Math.round(((cdf[oldValue] - cdfMin) / (totalPixels - cdfMin)) * 255);
            data[i] = newValue;
            data[i + 1] = newValue;
            data[i + 2] = newValue;
          }

          // Step 3: Apply adaptive thresholding (binarization)
          const blockSize = 15;
          const C = 10; // Constant subtracted from mean

          const integralImage = new Array(canvas.height).fill(0).map(() => new Array(canvas.width).fill(0));

          // Build integral image
          for (let y = 0; y < canvas.height; y++) {
            let sum = 0;
            for (let x = 0; x < canvas.width; x++) {
              const idx = (y * canvas.width + x) * 4;
              sum += data[idx];
              integralImage[y][x] = sum + (y > 0 ? integralImage[y - 1][x] : 0);
            }
          }

          // Apply adaptive threshold
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const x1 = Math.max(0, x - blockSize / 2);
              const x2 = Math.min(canvas.width - 1, x + blockSize / 2);
              const y1 = Math.max(0, y - blockSize / 2);
              const y2 = Math.min(canvas.height - 1, y + blockSize / 2);

              const count = (x2 - x1) * (y2 - y1);
              let sum = integralImage[y2][x2];
              if (x1 > 0) sum -= integralImage[y2][x1 - 1];
              if (y1 > 0) sum -= integralImage[y1 - 1][x2];
              if (x1 > 0 && y1 > 0) sum += integralImage[y1 - 1][x1 - 1];

              const mean = sum / count;
              const idx = (y * canvas.width + x) * 4;
              const pixel = data[idx];

              // Binarize: white if above threshold, black otherwise
              const threshold = mean - C;
              const binaryValue = pixel > threshold ? 255 : 0;
              data[idx] = binaryValue;
              data[idx + 1] = binaryValue;
              data[idx + 2] = binaryValue;
            }
          }

          // Put processed image data back
          ctx.putImageData(imageData, 0, 0);

          // Convert canvas to blob then to file
          canvas.toBlob((blob) => {
            if (blob) {
              const processedFile = new File([blob], file.name, { type: 'image/png' });
              resolve(processedFile);
            } else {
              reject(new Error('Could not create blob from canvas'));
            }
          }, 'image/png');
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

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
      'name of patient', 'patient full name', 'legal name', 'patent test', 'patent'
    ],
    pattern: /(?:Patient|Patent)\s+(.+?)\s+Age:/i
  },
  patientId: {
    variants: [
      'mrn', 'patient id', 'id', 'medical record number', 'record number',
      'patient number', 'chart number', 'account number', 'record no',
      'medical record no', 'pt id', 'patient mrn', 'patient 0'
    ],
    pattern: /Patient [0O]:\s*([A-Za-z0-9-]+)/i
  },
  dateOfBirth: {
    variants: [
      'dob', 'date of birth', 'birth date', 'birthdate', 'born',
      'date birth', 'patient dob', 'pt dob', 'birthday'
    ],
    pattern: /DOB:\s*(\d{2}\/\d{2}\/\d{4})/i
  },
  diagnosis: {
    variants: [
      'assessment', 'diagnosis', 'impression', 'dx', 'diagnoses',
      'primary diagnosis', 'clinical impression', 'findings', 'final diagnosis'
    ],
    pattern: /(?:DIAGNOSIS|FINAL DIAGNOSIS|ASSESSMENT):\s*([^\n]+(?:\n(?!(?:NOTE|SPECIMEN|CLINICAL))[^\n]*)*)/i
  }
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

// Spatial-aware field extraction using bounding boxes
function extractFieldWithSpatialAwareness(
  fieldVariants: string[],
  pattern: RegExp,
  minConfidence: number = 60
): string | null {
  const ocrData = globalThis.__ocrData;

  if (!ocrData || !ocrData.words || !ocrData.lines) {
    console.log('No spatial OCR data available, falling back to text-based extraction');
    return null;
  }

  console.log(`\nSpatial extraction for field variants: ${fieldVariants.join(', ')}`);

  // Strategy 1: Look for label-value pairs on the same line
  for (const line of ocrData.lines) {
    if (!line.words || line.words.length < 2) continue;
    if (line.confidence < minConfidence) continue;

    const lineText = line.text.toLowerCase();

    // Check if this line contains any of our field variants
    for (const variant of fieldVariants) {
      const normalizedVariant = normalizeText(variant);

      if (normalizeText(lineText).includes(normalizedVariant)) {
        console.log(`  ✓ Found potential label in line: "${line.text}" (confidence: ${line.confidence})`);

        // Find the label word and extract value words after it
        let labelEndIndex = -1;
        for (let i = 0; i < line.words.length; i++) {
          const wordText = normalizeText(line.words[i].text);
          if (wordText.includes(normalizedVariant) || similarity(wordText, normalizedVariant) > 0.7) {
            labelEndIndex = i;
            break;
          }
        }

        if (labelEndIndex !== -1 && labelEndIndex < line.words.length - 1) {
          // Extract remaining words as the value
          const valueWords = line.words.slice(labelEndIndex + 1)
            .filter(w => w.confidence >= minConfidence)
            .map(w => w.text.replace(/[:：\-]/g, '').trim())
            .filter(w => w.length > 0);

          if (valueWords.length > 0) {
            const value = valueWords.join(' ');
            console.log(`  ✓ Extracted value from same line: "${value}"`);
            return value;
          }
        }
      }
    }
  }

  // Strategy 2: Look for label on one line and value on the next line (vertical arrangement)
  for (let i = 0; i < ocrData.lines.length - 1; i++) {
    const line = ocrData.lines[i];
    const nextLine = ocrData.lines[i + 1];

    if (line.confidence < minConfidence || nextLine.confidence < minConfidence) continue;

    const lineText = normalizeText(line.text);

    for (const variant of fieldVariants) {
      const normalizedVariant = normalizeText(variant);

      if (similarity(lineText, normalizedVariant) > 0.7 || lineText.includes(normalizedVariant)) {
        // Check if the lines are vertically aligned (similar x-coordinates)
        const labelX = line.bbox.x0;
        const valueX = nextLine.bbox.x0;

        if (Math.abs(labelX - valueX) < 50) { // Tolerance for alignment
          console.log(`  ✓ Found label-value pair across lines:`);
          console.log(`     Label: "${line.text}" (confidence: ${line.confidence})`);
          console.log(`     Value: "${nextLine.text}" (confidence: ${nextLine.confidence})`);
          return nextLine.text.trim();
        }
      }
    }
  }

  // Strategy 3: Look for words near each other (horizontal proximity)
  for (let i = 0; i < ocrData.words.length - 1; i++) {
    const word = ocrData.words[i];
    if (word.confidence < minConfidence) continue;

    const wordText = normalizeText(word.text);

    for (const variant of fieldVariants) {
      const normalizedVariant = normalizeText(variant);

      if (similarity(wordText, normalizedVariant) > 0.7 || wordText.includes(normalizedVariant)) {
        // Find words to the right of this label word
        const labelRight = word.bbox.x1;
        const labelY = word.bbox.y0;

        const nearbyWords = ocrData.words
          .filter(w => {
            const isToTheRight = w.bbox.x0 > labelRight && w.bbox.x0 < labelRight + 300;
            const isSameRow = Math.abs(w.bbox.y0 - labelY) < 20;
            const hasGoodConfidence = w.confidence >= minConfidence;
            return isToTheRight && isSameRow && hasGoodConfidence;
          })
          .sort((a, b) => a.bbox.x0 - b.bbox.x0);

        if (nearbyWords.length > 0) {
          const value = nearbyWords
            .map(w => w.text.replace(/[:：\-]/g, '').trim())
            .filter(w => w.length > 0)
            .join(' ');

          if (value.length > 0) {
            console.log(`  ✓ Extracted value from nearby words: "${value}"`);
            console.log(`     Average confidence: ${nearbyWords.reduce((sum, w) => sum + w.confidence, 0) / nearbyWords.length}`);
            return value;
          }
        }
      }
    }
  }

  console.log('  ✗ No spatial match found');
  return null;
}

// Extract field value using multiple strategies
function extractField(rawText: string, fieldVariants: string[], pattern: RegExp): string | null {
  const lines = rawText.split('\n');
  const candidates: Array<{value: string, confidence: number, lineNumber: number}> = [];
  
  console.log(`\nLooking for field variants: ${fieldVariants.join(', ')}`);
  
  // Strategy 0: Try pattern matching first on the entire text
  const patMatch = rawText.match(pattern);
  if (patMatch) {
    const extracted = patMatch[1]?.trim();
    if (extracted) {
      console.log("Pattern match strategy: " + extracted); 
      candidates.push({
        value: extracted,
        confidence: 1,
        lineNumber: -1
      });
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    console.log(`Processing line ${i}: "${line}"`);
    
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
            candidates.push({
              value: cleanValue,
              confidence: matchScore + 0.3,
              lineNumber: i
            });
          } else if (i + 1 < lines.length) {
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
          break;
        }
      }
    }
    
    // Strategy 2: Look for field name at start of line, value after
    console.log('Strategy 2');
    const words = line.split(/\s+/);
    for (let wordCount = 1; wordCount <= Math.min(4, words.length); wordCount++) {
      const potentialLabel = words.slice(0, wordCount).join(' ');
      
      for (const variant of fieldVariants) {
        const matchScore = similarity(normalizeText(potentialLabel), normalizeText(variant));
        if (matchScore >= 0.7 || normalizeText(potentialLabel).includes(normalizeText(variant))) {
          console.log(`  ✓ Word match found for "${potentialLabel}" (score: ${matchScore})`);
          
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
            const nextLine = lines[i + 1].trim();
            if (nextLine && !nextLine.includes(':') && nextLine.length > 1) {
              console.log(`  ✓ Next line value: "${nextLine}"`);
              candidates.push({
                value: nextLine,
                confidence: matchScore - 0.1,
                lineNumber: i
              });
            }
          }
          break;
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

// Enhanced OCR extraction with preprocessing and detailed output
export async function extractTextFromImage(file: File): Promise<string> {
  console.log('Starting enhanced OCR extraction...');

  try {
    // Step 1: Preprocess the image for better OCR accuracy
    console.log('Preprocessing image...');
    const preprocessedFile = await preprocessImage(file);
    console.log('Image preprocessing complete');

    // Step 2: Perform OCR with detailed output
    console.log('Performing OCR...');
    const result = await Tesseract.recognize(preprocessedFile, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    console.log(`OCR complete. Confidence: ${result.data.confidence}%`);

    // Store the enhanced data for spatial-aware extraction
    globalThis.__ocrData = {
      text: result.data.text,
      confidence: result.data.confidence,
      lines: result.data.lines,
      words: result.data.words,
      blocks: result.data.blocks,
    };

    return result.data.text;
  } catch (error) {
    console.error('Enhanced OCR failed, falling back to basic OCR:', error);

    // Fallback to basic OCR without preprocessing
    const { data: { text } } = await Tesseract.recognize(file, 'eng', {
      logger: (m) => console.log('OCR Progress:', m.progress),
    });
    return text;
  }
}

export function parseEMRText(rawText: string): EMRData {
  console.log('Raw text to parse:\n', rawText);
  console.log('\n=== Starting enhanced field extraction ===');

  // Clean up common OCR artifacts
  const cleanedText = rawText
    .replace(/\|/g, 'I')
    .replace(/[O0]/g, (match, offset) => {
      const before = rawText[offset - 1];
      const after = rawText[offset + 1];
      if (/\d/.test(before) || /\d/.test(after)) return '0';
      return 'O';
    });

  // Try spatial-aware extraction first, then fall back to text-based extraction
  console.log('\n--- Attempting spatial-aware extraction ---');
  let patientName = extractFieldWithSpatialAwareness(
    fieldVariants.patientName.variants,
    fieldVariants.patientName.pattern
  );
  if (!patientName) {
    console.log('Falling back to text-based extraction for patient name');
    patientName = extractField(
      cleanedText,
      fieldVariants.patientName.variants,
      fieldVariants.patientName.pattern
    );
  }
  patientName = patientName || 'Unknown';

  let patientId = extractFieldWithSpatialAwareness(
    fieldVariants.patientId.variants,
    fieldVariants.patientId.pattern
  );
  if (!patientId) {
    console.log('Falling back to text-based extraction for patient ID');
    patientId = extractField(
      cleanedText,
      fieldVariants.patientId.variants,
      fieldVariants.patientId.pattern
    );
  }
  patientId = patientId || 'N/A';

  let dateOfBirth = extractFieldWithSpatialAwareness(
    fieldVariants.dateOfBirth.variants,
    fieldVariants.dateOfBirth.pattern
  );
  if (!dateOfBirth) {
    console.log('Falling back to text-based extraction for date of birth');
    dateOfBirth = extractField(
      cleanedText,
      fieldVariants.dateOfBirth.variants,
      fieldVariants.dateOfBirth.pattern
    );
  }
  dateOfBirth = dateOfBirth || 'N/A';

  let diagnosis = extractFieldWithSpatialAwareness(
    fieldVariants.diagnosis.variants,
    fieldVariants.diagnosis.pattern
  );
  if (!diagnosis) {
    console.log('Falling back to text-based extraction for diagnosis');
    diagnosis = extractField(
      cleanedText,
      fieldVariants.diagnosis.variants,
      fieldVariants.diagnosis.pattern
    );
  }
  diagnosis = diagnosis || 'N/A';

  console.log('\n=== Final extracted fields ===');
  console.log('Patient Name:', patientName);
  console.log('Patient ID:', patientId);
  console.log('Date of Birth:', dateOfBirth);
  console.log('Diagnosis:', diagnosis);

  // Get overall OCR confidence if available
  const ocrData = globalThis.__ocrData;
  if (ocrData && ocrData.confidence) {
    console.log('Overall OCR Confidence:', ocrData.confidence.toFixed(2) + '%');
  }

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
  const medHeaders = ['medications', 'meds', 'current medications', 'rx', 'prescriptions', 'drug list', 'medicines', 'medication list'];

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  let inMedSection = false;
  const medications: string[] = [];
  let sectionEndReached = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we've found the medication section header
    if (!inMedSection && findBestMatch(line, medHeaders, 0.5)) {
      inMedSection = true;
      console.log(`Found medication section at line ${i}: "${line}"`);
      continue;
    }

    // Check if we've reached the end of the medication section
    if (inMedSection && line.match(/^(lab|diagnosis|assessment|history|physical exam|plan|vital|allergies|specimen|clinical data|note)[\s:]/i)) {
      console.log(`Medication section ended at line ${i}: "${line}"`);
      sectionEndReached = true;
      break;
    }

    // Extract medication entries
    if (inMedSection && line.length > 0 && !sectionEndReached) {
      // Remove common list markers
      const cleaned = line
        .replace(/^[-•*\d+.)\]]\s*/, '')
        .replace(/^[A-Z][\)\.]\s*/, '') // Remove "A)", "B.", etc.
        .trim();

      // Skip lines that look like section headers
      if (cleaned.length > 2 && !cleaned.match(/^[A-Za-z\s]+[:：]$/)) {
        medications.push(cleaned);
        console.log(`  Extracted medication: "${cleaned}"`);
      }
    }
  }

  console.log(`Total medications extracted: ${medications.length}`);
  return medications;
}

function extractLabResults(text: string): string[] {
  // Strategy 1: Look for CLINICAL DATA section with multiple patterns
  const clinicalDataPatterns = [
    /CLINICAL DATA:\s*([^\n]+)/i,
    /Clinical Data:\s*([^\n]+)/i,
    /CLINICAL:\s*([^\n]+)/i
  ];

  for (const pattern of clinicalDataPatterns) {
    const match = text.match(pattern);
    if (match) {
      const [, data] = match;
      // Try multiple delimiters: semicolon, comma, and newline
      let codes = data.split(/[;,]/).map(code => code.trim()).filter(code => code.length > 0);

      if (codes.length > 0) {
        console.log(`Extracted ${codes.length} lab results from CLINICAL DATA section using semicolon/comma split`);
        return codes;
      }

      // If no semicolons/commas, try splitting by whitespace for codes
      codes = data.split(/\s+/).filter(code => code.length > 0);
      if (codes.length > 0) {
        console.log(`Extracted ${codes.length} lab results from CLINICAL DATA section using whitespace split`);
        return codes;
      }
    }
  }

  // Strategy 2: Multi-line CLINICAL DATA extraction
  const multiLineMatch = text.match(/CLINICAL DATA:\s*([^\n]+(?:\n(?!(?:SPECIMEN|DIAGNOSIS|NOTE))[^\n]*)*)/i);
  if (multiLineMatch) {
    const [, data] = multiLineMatch;
    const codes = data.split(/[;,\n]/)
      .map(code => code.trim())
      .filter(code => code.length > 0 && !code.match(/^[A-Za-z\s]+:$/));

    if (codes.length > 0) {
      console.log(`Extracted ${codes.length} lab results from multi-line CLINICAL DATA section`);
      return codes;
    }
  }

  // Strategy 3: Fallback to section-based extraction
  const labHeaders = [
    'lab results', 'labs', 'laboratory', 'lab values', 'test results',
    'laboratory results', 'blood work', 'clinical data', 'lab work'
  ];

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  let inLabSection = false;
  const labResults: string[] = [];
  let sectionEndReached = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inLabSection && findBestMatch(line, labHeaders, 0.5)) {
      inLabSection = true;
      console.log(`Found lab section at line ${i}: "${line}"`);
      continue;
    }

    if (inLabSection && line.match(/^(medications|diagnosis|assessment|history|plan|vital|allergies|specimen|note)[\s:]/i)) {
      console.log(`Lab section ended at line ${i}: "${line}"`);
      sectionEndReached = true;
      break;
    }

    if (inLabSection && line.length > 0 && !sectionEndReached) {
      const cleaned = line
        .replace(/^[-•*\d+.)\]]\s*/, '')
        .replace(/^[A-Z][\)\.]\s*/, '')
        .trim();

      if (cleaned.length > 2 && !cleaned.match(/^[A-Za-z\s]+[:：]$/)) {
        labResults.push(cleaned);
        console.log(`  Extracted lab result: "${cleaned}"`);
      }
    }
  }

  console.log(`Total lab results extracted: ${labResults.length}`);
  return labResults;
}

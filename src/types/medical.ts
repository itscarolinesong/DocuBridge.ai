export interface EMRData {
  patientName: string;
  patientId: string;
  dateOfBirth: string;
  diagnosis: string;
  medications: string[];
  labResults: string[];
  rawText: string;
}

export interface ReportSection {
  header: string;
  content: string;
  editable: boolean;
}

export interface ReportSuggestion {
  id: string;
  title: string;
  sections: ReportSection[];
}

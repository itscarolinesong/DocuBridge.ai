'use client';

import { useState } from 'react';
import { LoginPage } from '@/components/LoginPage';
import { OCRUploader } from '@/components/OCRUploader';
import { ReportApproval } from '@/components/ReportApproval';
import { EMRData, ReportSection, FinalizedReport, ReportSuggestion } from '@/types/medical';
import { FileText, ArrowRight, CheckCircle } from 'lucide-react';
import jsPDF from 'jspdf';

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [emrData, setEMRData] = useState<EMRData | null>(null);
  const [reportSuggestions, setReportSuggestions] = useState<ReportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [finalizedReport, setFinalizedReport] = useState<FinalizedReport | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);


  const handleOCRComplete = async (data: EMRData, imageDataUrl: string) => {
    setEMRData(data);
    setUploadedImage(imageDataUrl);
    setLoading(true);
    
    try {
      const response = await fetch('http://localhost:4111/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emrData: data,
          reportType: 'pathology',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate report');
      }

      const result = await response.json();
      
      setReportSuggestions([
        {
          id: 'ai-generated',
          title: 'AI-Generated Report',
          sections: result.sections,
        },
      ]);

      setStep(2);
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to generate report. Make sure backend is running on port 4111.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = (report: FinalizedReport) => {
    console.log('Final Report:', report);
    setFinalizedReport(report);
    setStep(3);
  };

  const downloadReport = () => {
    if (!emrData || !finalizedReport) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let yPosition = 20;

    // Title
    doc.setFontSize(20);
    doc.text('Medical Pathology Report', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Only include approved sections
    finalizedReport.sections.forEach((section: ReportSection) => {
      // Skip rejected sections
      if (finalizedReport.approvals[section.header] === false) return;
      
      // Section header
      doc.setFontSize(14);
      doc.text(section.header, 15, yPosition);
      yPosition += 7;

      // Use modified content if available, otherwise use original
      const content = finalizedReport.modifications[section.header] || section.content;
      
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(content, pageWidth - 30);
      lines.forEach((line: string) => {
        if (yPosition > 270) {
          doc.addPage();
          yPosition = 20;
        }
        doc.text(line, 15, yPosition);
        yPosition += 5;
      });
      yPosition += 5;
    });

    doc.save(`report-${emrData.patientId}-${Date.now()}.pdf`);
  };

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <FileText className="w-8 h-8 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">DocBridge.ai</h1>
          <span className="ml-auto text-sm text-gray-500">
            Cedar × Mastra
          </span>
        </div>
      </header>

      {/* Progress Indicator */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-center gap-4 mb-12">
          <StepIndicator number={1} label="Extract EMR" active={step >= 1} />
          <ArrowRight className="text-gray-400" />
          <StepIndicator number={2} label="Review Report" active={step >= 2} />
          <ArrowRight className="text-gray-400" />
          <StepIndicator number={3} label="Complete" active={step >= 3} />
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Upload Patient EMR</h2>
              <p className="text-gray-600 mb-8">
                Upload scanned or photocopied EMR. All processing happens locally.
              </p>
              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
                  <p className="text-lg text-gray-600">Generating report with AI...</p>
                </div>
              ) : (
                <OCRUploader onComplete={handleOCRComplete} />
              )}
            </>
          )}

          {step === 2 && reportSuggestions.length > 0 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Review & Approve Report</h2>
              <p className="text-gray-600 mb-8">
                AI-generated report ready for review. Approve, reject, or modify sections.
              </p>
              <ReportApproval
                suggestions={reportSuggestions}
                onFinalize={handleFinalize}
                originalImage={uploadedImage}
              />
            </>
          )}

          {step === 3 && (
            <div className="text-center py-12">
              <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-4" />
              <h2 className="text-3xl font-bold mb-2">Report Complete!</h2>
              <p className="text-gray-600 mb-6">
                Your pathology report has been finalized.
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={downloadReport}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
                >
                  Download Report (PDF)
                </button>
                <button
                  onClick={() => setStep(1)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
                >
                  Process Another EMR
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepIndicatorProps {
  number: number;
  label: string;
  active: boolean;
}

function StepIndicator({ number, label, active }: StepIndicatorProps) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'text-blue-600' : 'text-gray-400'}`}>
      <div className={`
        w-10 h-10 rounded-full flex items-center justify-center font-bold
        ${active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}
      `}>
        {number}
      </div>
      <span className="font-medium">{label}</span>
    </div>
  );
}
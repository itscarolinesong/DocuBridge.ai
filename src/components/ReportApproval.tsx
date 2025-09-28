'use client';

import React, { useState } from 'react';
import { Check, X, Edit3, Download, Loader2 } from 'lucide-react';
import { ReportSection } from '@/types/medical';

interface Props {
  suggestions: any[];
  onFinalize: (report: any) => void;
  originalImage: string | null;
}

export function ReportApproval({ suggestions, onFinalize, originalImage }: Props) {
  const [selectedReport, setSelected] = useState(suggestions[0]);
  const [modifications, setModifications] = useState<Record<string, string>>({});
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const handleApprove = (header: string) => {
    setApprovals(prev => ({ ...prev, [header]: true }));
  };

  const handleReject = (header: string) => {
    setApprovals(prev => ({ ...prev, [header]: false }));
  };

  const handleModify = (header: string, content: string) => {
    setModifications(prev => ({ ...prev, [header]: content }));
  };

  const handleRegenerate = async (sectionHeader: string) => {
    setRegenerating(sectionHeader);
    
    try {
      const currentSection = selectedReport.sections.find((s: any) => s.header === sectionHeader);
      const response = await fetch('http://localhost:4111/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionHeader,
          currentContent: modifications[sectionHeader] || currentSection?.content,
          feedback: feedback[sectionHeader],
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        handleModify(sectionHeader, result.newContent);
        setFeedback(prev => ({ ...prev, [sectionHeader]: '' }));
      } else {
        alert('Failed to regenerate. Please try again.');
      }
    } catch (error) {
      console.error('Regeneration failed:', error);
      alert('Failed to regenerate. Please try again.');
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <div className="flex gap-6 w-full max-w-7xl mx-auto">
      {/* Left: Original EMR Image */}
      {originalImage && (
        <div className="w-2/3 sticky top-8 h-fit">
          <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
            <h3 className="text-lg font-bold text-gray-800 mb-3">Original EMR</h3>
            <img 
              src={originalImage} 
              alt="Original EMR Document" 
              className="w-full rounded-lg border border-gray-300 shadow-sm"
            />
          </div>
        </div>
      )}

      {/* Right: Report Review */}
      <div className={`${originalImage ? 'w-2/3' : 'w-full'} space-y-6`}>
        {/* Template Selector */}
        <div className="flex gap-3">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => setSelected(suggestion)}
              className={`
                px-4 py-2 rounded-lg font-medium transition-all
                ${selectedReport.id === suggestion.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              {suggestion.title}
            </button>
          ))}
        </div>

        {/* Cedar Diff UI - Section Review */}
        {selectedReport.sections.map((section: ReportSection, idx: number) => (
          <div
            key={idx}
            className={`
              border-2 rounded-xl p-6 transition-all
              ${approvals[section.header] === true
                ? 'border-green-500 bg-green-50'
                : approvals[section.header] === false
                ? 'border-red-500 bg-red-50'
                : 'border-gray-200 bg-white'
              }
            `}
          >
            {/* Header with Actions */}
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                {section.header}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove(section.header)}
                  className="p-2 rounded-lg hover:bg-green-100 transition-colors"
                  title="Approve"
                >
                  <Check className="w-5 h-5 text-green-600" />
                </button>
                <button
                  onClick={() => handleReject(section.header)}
                  className="p-2 rounded-lg hover:bg-red-100 transition-colors"
                  title="Reject"
                >
                  <X className="w-5 h-5 text-red-600" />
                </button>
              </div>
            </div>

            {/* Content */}
            {section.editable ? (
              <div className="space-y-4">
                <div className="relative">
                  <textarea
                    value={modifications[section.header] || section.content}
                    onChange={(e) => handleModify(section.header, e.target.value)}
                    className="w-full p-4 border rounded-lg font-mono text-sm
                      focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={6}
                  />
                  <Edit3 className="absolute top-3 right-3 w-4 h-4 text-gray-400" />
                </div>

                {/* AI Feedback Section - only show if NOT Patient Information */}
                {section.header !== 'Patient Information' && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
                    <label className="text-sm font-medium text-purple-900">
                      Give AI feedback to improve this section:
                    </label>
                    <textarea
                      placeholder="e.g., 'Make this more detailed' or 'Focus on patient safety concerns'"
                      className="w-full p-3 border border-purple-300 rounded-lg text-sm"
                      rows={2}
                      value={feedback[section.header] || ''}
                      onChange={(e) => setFeedback(prev => ({ ...prev, [section.header]: e.target.value }))}
                      disabled={regenerating === section.header}
                    />
                    <button
                      onClick={() => handleRegenerate(section.header)}
                      disabled={!feedback[section.header]?.trim() || regenerating === section.header}
                      className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 
                        disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium
                        flex items-center justify-center gap-2"
                    >
                      {regenerating === section.header ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Regenerating...
                        </>
                      ) : (
                        'Regenerate with AI Feedback'
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-gray-50 rounded-lg font-mono text-sm whitespace-pre-wrap">
                {section.content}
              </div>
            )}

            {/* Status Badge */}
            {approvals[section.header] === true && (
              <div className="mt-3 flex items-center gap-2 text-sm font-medium text-green-600">
                <Check className="w-4 h-4" />
                Approved
              </div>
            )}
          </div>
        ))}

        {/* Finalize Button */}
        <button
          onClick={() => {
            // Check if all sections have been reviewed
            const unreviewedSections = selectedReport.sections.filter(
              (section: ReportSection) => approvals[section.header] === undefined
            );

            if (unreviewedSections.length > 0) {
              alert(`Please review all sections before finalizing. Unreviewed sections:\n${unreviewedSections.map((s: any) => `- ${s.header}`).join('\n')}`);
              return;
            }

            // Check if at least one section is approved
            const hasApprovedSections = Object.values(approvals).some(val => val === true);
            if (!hasApprovedSections) {
              alert('You must approve at least one section to finalize the report.');
              return;
            }

            onFinalize({ ...selectedReport, modifications, approvals });
          }}
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 
            text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700
            transition-all flex items-center justify-center gap-2"
        >
          <Download className="w-5 h-5" />
          Finalize Report
        </button>
      </div>
    </div>
  );
}
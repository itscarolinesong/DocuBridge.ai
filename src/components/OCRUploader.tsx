'use client';

import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { extractTextFromImage, parseEMRText } from '@/lib/ocr';
import { EMRData } from '@/types/medical';
import { Upload, Loader2, Shield } from 'lucide-react';

interface Props {
  onComplete: (data: EMRData, imageDataUrl: string) => void;
}

export function OCRUploader({ onComplete }: Props) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');

  const onDrop = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setIsProcessing(true);

    try {
      setProgress('Running OCR locally...');
      const text = await extractTextFromImage(file);
      
      setProgress('Parsing medical data...');
      const emrData = await parseEMRText(text);
      
      setProgress('Complete!');
      
      // Convert file to base64 data URL instead of blob URL
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageDataUrl = reader.result as string;
        setTimeout(() => onComplete(emrData, imageDataUrl), 500);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('OCR Error:', error);
      setProgress('Error processing document');
      setTimeout(() => setIsProcessing(false), 1000);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg'] },
    maxFiles: 1,
  });

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-12 text-center 
          cursor-pointer transition-all
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400'
          }
          ${isProcessing ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {isProcessing ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-16 h-16 animate-spin text-blue-500" />
            <p className="text-lg font-medium text-gray-700">{progress}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Upload className="w-16 h-16 text-gray-400" />
            <div>
              <p className="text-xl font-semibold text-gray-800">
                Drop EMR Document Here
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Supports images (PNG, JPG)
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-green-600">
        <Shield className="w-4 h-4" />
        <span className="font-medium">
          100% local processing - no data uploaded
        </span>
      </div>
    </div>
  );
}
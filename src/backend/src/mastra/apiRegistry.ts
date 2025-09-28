import { registerApiRoute } from '@mastra/core/server';
import { ChatInputSchema, ChatOutput, chatWorkflow } from './workflows/chatWorkflow';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createSSEStream } from '../utils/streamUtils';
import { z } from 'zod';

// Helper function to convert Zod schema to OpenAPI schema
function toOpenApiSchema(schema: Parameters<typeof zodToJsonSchema>[0]) {
  return zodToJsonSchema(schema) as Record<string, unknown>;
}

const GenerateReportSchema = z.object({
  emrData: z.object({
    patientName: z.string(),
    patientId: z.string(),
    dateOfBirth: z.string(),
    diagnosis: z.string(),
    medications: z.array(z.string()),
    labResults: z.array(z.string()),
    rawText: z.string(),
  }),
  reportType: z.string().optional().default('pathology'),
});

const RegenerateSectionSchema = z.object({
  sectionHeader: z.string(),
  currentContent: z.string(),
  feedback: z.string(),
});

/**
 * API routes for the Mastra backend
 */
export const apiRoutes = [
  registerApiRoute('/chat/stream', {
    method: 'POST',
    openapi: {
      requestBody: {
        content: {
          'application/json': {
            schema: toOpenApiSchema(ChatInputSchema),
          },
        },
      },
    },
    handler: async (c) => {
      try {
        const body = await c.req.json();
        const {
          prompt,
          temperature,
          maxTokens,
          systemPrompt,
          additionalContext,
          resourceId,
          threadId,
        } = ChatInputSchema.parse(body);

        return createSSEStream(async (controller) => {
          const run = await chatWorkflow.createRunAsync();
          const result = await run.start({
            inputData: {
              prompt,
              temperature,
              maxTokens,
              systemPrompt,
              streamController: controller,
              additionalContext,
              resourceId,
              threadId,
            },
          });

          if (result.status !== 'success') {
            throw new Error(`Workflow failed: ${result.status}`);
          }
        });
      } catch (error) {
        console.error(error);
        return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
      }
    },
  }),
  
  registerApiRoute('/generate-report', {
    method: 'POST',
    openapi: {
      requestBody: {
        content: {
          'application/json': {
            schema: toOpenApiSchema(GenerateReportSchema),
          },
        },
      },
    },
    handler: async (c) => {
      try {
        const body = await c.req.json();
        const { emrData, reportType } = GenerateReportSchema.parse(body);

        // Template-based generation (reliable for demo)
        const sections = [
          {
            header: 'Patient Information',
            content: `Name: ${emrData.patientName}\nID: ${emrData.patientId}\nDOB: ${emrData.dateOfBirth}`,
            editable: true,
          },
          {
            header: 'Clinical History',
            content: `Primary Diagnosis: ${emrData.diagnosis}\n\nThe patient presents with documented medical history as indicated in transferred records.`,
            editable: true,
          },
          {
            header: 'Current Medications',
            content: emrData.medications.join('\n'),
            editable: true,
          },
          {
            header: 'Laboratory Results',
            content: emrData.labResults.join('\n'),
            editable: true,
          },
          {
            header: 'Assessment',
            content: `Based on clinical presentation and laboratory findings, assessment indicates ${emrData.diagnosis}. Current medication regimen appears appropriate for condition management.`,
            editable: true,
          },
          {
            header: 'Plan',
            content: `1. Continue current medication regimen\n2. Monitor laboratory values\n3. Follow-up in 2-4 weeks\n4. Patient education regarding condition management`,
            editable: true,
          },
          {
            header: 'Notes',
            content: ``,
            editable: true,
          }
        ];

        const reportText = sections.map(s => `## ${s.header}\n${s.content}`).join('\n\n');

        return c.json({
          success: true,
          report: reportText,
          sections,
        });
      } catch (error) {
        console.error('Error generating report:', error);
        return c.json(
          { error: error instanceof Error ? error.message : 'Failed to generate report' },
          500
        );
      }
    },
  }),

  registerApiRoute('/regenerate-section', {
    method: 'POST',
    openapi: {
      requestBody: {
        content: {
          'application/json': {
            schema: toOpenApiSchema(RegenerateSectionSchema),
          },
        },
      },
    },
    handler: async (c) => {
      try {
        const { sectionHeader, currentContent, feedback } = RegenerateSectionSchema.parse(await c.req.json());

        // Call Ollama directly for AI regeneration
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2:3b',
            prompt: `You are a medical report assistant. Improve this section based on the doctor's feedback.

Section: ${sectionHeader}

Current Content:
${currentContent}

Doctor's Feedback:
${feedback}

Generate ONLY the improved section content (no section headers, no explanations, no extra commentary). Be professional, medically accurate, and address the doctor's feedback directly:`,
            stream: false,
          }),
        });

        if (!ollamaResponse.ok) {
          throw new Error('Ollama API error');
        }

        const data = await ollamaResponse.json();
        
        return c.json({
          success: true,
          newContent: data.response.trim(),
        });
      } catch (error) {
        console.error('Regeneration error:', error);
        return c.json({ 
          error: 'Failed to regenerate section. Make sure Ollama is running.',
          success: false 
        }, 500);
      }
    },
  }),
];
'use client';

import { CedarCopilot } from 'cedar-os';

export function CedarProvider({ children }: { children: React.ReactNode }) {
  return (
    <CedarCopilot
      llmProvider={{
        provider: 'mastra',
        baseURL: 'http://localhost:4111',
      }}
    >
      {children}
    </CedarCopilot>
  );
}

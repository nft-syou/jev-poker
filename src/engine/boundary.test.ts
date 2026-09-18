import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = ['react', 'react-dom', '@typesafe-ai/sdk', '../jev', '../agents', '../../bench'];

describe('engine boundary', () => {
  it('imports nothing outside src/engine and node builtins', () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec.startsWith('./') , `${f} imports ${spec}`).toBe(true);
        for (const bad of FORBIDDEN) expect(spec.includes(bad), `${f} imports ${spec}`).toBe(false);
      }
    }
  });
});

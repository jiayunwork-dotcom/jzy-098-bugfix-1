import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPipeline, simulateAll } from './pipeline';
import { RegexError } from './parser/errors';
import { EXAMPLES } from './examples';
import type { BuildResponse } from '../../shared/types';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT ?? 3001);

/** 简单的内存缓存：同一正则只构造一次 */
const cache = new Map<string, ReturnType<typeof buildPipeline>>();

function getBuild(pattern: string) {
  let data = cache.get(pattern);
  if (!data) {
    data = buildPipeline(pattern);
    cache.set(pattern, data);
  }
  return data;
}

app.post('/api/build', (req, res) => {
  const pattern = String(req.body?.pattern ?? '');
  try {
    const data = getBuild(pattern);
    const body: BuildResponse = { ok: true, data };
    res.json(body);
  } catch (err) {
    if (err instanceof RegexError) {
      res.status(400).json({
        ok: false,
        error: {
          message: err.message,
          position: err.position,
          endPosition: err.endPosition,
          source: pattern,
        },
      });
      return;
    }
    res.status(500).json({
      ok: false,
      error: { message: err instanceof Error ? err.message : '构造失败' },
    });
  }
});

app.post('/api/simulate', (req, res) => {
  const pattern = String(req.body?.pattern ?? '');
  const input = String(req.body?.input ?? '');
  try {
    const data = getBuild(pattern);
    res.json(simulateAll(data, input));
  } catch (err) {
    if (err instanceof RegexError) {
      res.status(400).json({
        ok: false,
        error: {
          message: err.message,
          position: err.position,
          endPosition: err.endPosition,
          source: pattern,
        },
      });
      return;
    }
    res.status(500).json({
      ok: false,
      error: { message: err instanceof Error ? err.message : '模拟失败' },
    });
  }
});

app.get('/api/examples', (_req, res) => {
  res.json({ ok: true, examples: EXAMPLES });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/* 生产模式：由后端在同端口托管前端打包产物（Docker 单容器） */
function serveFrontend() {
  // ESM/CJS 双保险地定位静态目录
  const candidates = [
    path.resolve(__dirname, '../../../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
  ];
  const distDir = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (!distDir) {
    console.warn('[server] 未找到 frontend/dist，仅提供 API（开发模式请用 Vite 5173 端口）');
    return;
  }
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

serveFrontend();

app.listen(PORT, () => {
  console.log(`[regex-pipeline] server listening on http://0.0.0.0:${PORT}`);
});

// 供测试直接导入 app
export { app };
export const __dirnameCjs = __dirname;
void fileURLToPath;

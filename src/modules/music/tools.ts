/**
 * The two helper programs music needs:
 *  - ffmpeg: turns any audio into Discord's format. Installed by the system (apk on Shulker, winget
 *    on the PC) or pointed at with FFMPEG_PATH.
 *  - yt-dlp: reads YouTube/SoundCloud. The bot downloads the official build by itself into
 *    TOOLS_DIR and updates it once a day, because YouTube changes often and old copies stop working.
 */
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '../../core/errors.js';
import { log } from '../../core/logger.js';

const UPDATE_EVERY_MS = 24 * 3600_000;

export function defaultToolsDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'SatanBot', 'bin');
  }
  return join(process.cwd(), 'tools');
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return !report?.header?.glibcVersionRuntime;
}

/** The official yt-dlp release file for this machine. */
export function ytdlpAssetName(): string {
  const arm = process.arch === 'arm64';
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (isMusl()) return arm ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_musllinux';
  return arm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a program and collects its output (capped), killing it after `timeoutMs`. */
export function run(file: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cap = 20 * 1024 * 1024;
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < cap) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// ───── ffmpeg ─────

let ffmpegPath: string | null = null;

function wingetFfmpeg(): string | null {
  const base = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of readdirSync(base).filter((n) => n.toLowerCase().includes('ffmpeg'))) {
      for (const build of readdirSync(join(base, pkg))) {
        const exe = join(base, pkg, build, 'bin', 'ffmpeg.exe');
        if (existsSync(exe)) return exe;
      }
    }
  } catch {
    /* not installed through winget */
  }
  return null;
}

/** Finds ffmpeg once (FFMPEG_PATH, then PATH, then a winget install). */
export async function findFfmpeg(): Promise<string> {
  if (ffmpegPath) return ffmpegPath;
  const candidates = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    process.platform === 'win32' ? wingetFfmpeg() : null,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const ok = await run(c, ['-hide_banner', '-version'], 10_000)
      .then((r) => r.code === 0)
      .catch(() => false);
    if (ok) {
      ffmpegPath = c;
      return c;
    }
  }
  throw new DomainError(
    'NO_FFMPEG',
    'Music is not available: the audio program (ffmpeg) is not installed on the bot’s computer. The bot owner can fix this (see the hosting guide).',
    'Music unavailable',
  );
}

// ───── yt-dlp ─────

let ytdlpReady: Promise<string> | null = null;

async function download(url: string, target: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const tmp = `${target}.download`;
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  renameSync(tmp, target);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
}

async function prepareYtdlp(): Promise<string> {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const dir = process.env.TOOLS_DIR || defaultToolsDir();
  mkdirSync(dir, { recursive: true });
  const asset = ytdlpAssetName();
  const file = join(dir, asset);
  if (!existsSync(file)) {
    log.info('YTDLP_DOWNLOADING', { asset, dir });
    await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, file);
    log.info('YTDLP_READY', { file });
  }
  return file;
}

/** Path to a working yt-dlp (downloads it on first use). */
export function ytdlp(): Promise<string> {
  ytdlpReady ??= prepareYtdlp().catch((err: unknown) => {
    ytdlpReady = null;
    log.error('YTDLP_UNAVAILABLE', undefined, err);
    throw new DomainError(
      'NO_YTDLP',
      'Music is not available right now: the bot could not download its YouTube reader. Try again in a minute.',
      'Music unavailable',
    );
  });
  return ytdlpReady;
}

/** Updates yt-dlp when it is older than a day. Safe to call often; runs in the background. */
export async function updateYtdlpIfOld(): Promise<void> {
  if (process.env.YTDLP_PATH) return;
  const file = await ytdlp().catch(() => null);
  if (!file) return;
  const age = Date.now() - statSync(file).mtimeMs;
  if (age < UPDATE_EVERY_MS) return;
  const r = await run(file, ['-U'], 180_000).catch((err: unknown) => ({
    code: -1,
    stdout: '',
    stderr: String(err),
  }));
  const now = new Date();
  utimesSync(file, now, now);
  if (r.code === 0)
    log.info('YTDLP_UPDATE_CHECKED', { result: r.stdout.trim().split('\n').pop()?.slice(0, 120) ?? '' });
  else log.warn('YTDLP_UPDATE_FAILED', { error: r.stderr.slice(0, 300) });
}

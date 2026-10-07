#!/usr/bin/env node
import { readFile, mkdir, mkdtemp, rename, rm, writeFile, lstat, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSpriteProfile, compileSvgProfile, type SvgProfileBuild } from '@iconforge/compiler-core';
import { openProjectArchive } from '@iconforge/persistence';

export interface CompileArgs { input: string; profile: string; out: string; check: boolean }

function parseArgs(args: string[]): CompileArgs {
  if (args.shift() !== 'compile') throw new TypeError('cli.command.unsupported');
  const input = args.shift();
  if (!input || input.startsWith('--')) throw new TypeError('cli.input.required');
  let profile: string | undefined;
  let out: string | undefined;
  let check = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--check' && !check) check = true;
    else if (flag === '--profile' && !profile) profile = args.shift();
    else if (flag === '--out' && !out) out = args.shift();
    else throw new TypeError('cli.argument.invalid');
  }
  if (!profile || profile.startsWith('--') || !out || out.startsWith('--')) throw new TypeError('cli.argument.required');
  return { input, profile, out, check };
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function verifyBuild(out: string, build: SvgProfileBuild): Promise<boolean> {
  const expected: Record<string, Uint8Array> = { ...build.artifacts, 'manifest.json': build.manifestBytes };
  for (const [path, bytes] of Object.entries(expected)) {
    try {
      const actual = await readFile(join(out, path));
      if (!actual.equals(Buffer.from(bytes))) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

export async function compileCommand(args: CompileArgs): Promise<0 | 1> {
  if ((await stat(args.input)).size > 64 * 1024 * 1024) throw new TypeError('cli.project.size-limit');
  const bytes = await readFile(args.input);
  let opened: Awaited<ReturnType<typeof openProjectArchive>>;
  try { opened = await openProjectArchive(bytes); }
  catch (error) { throw new TypeError(`cli.project.invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (opened.mode !== 'read-write') throw new TypeError('cli.project.read-only');
  const build = opened.project.exportProfiles.find(profile => profile.name === args.profile)?.target === 'sprite'
    ? compileSpriteProfile(opened.project, args.profile) : compileSvgProfile(opened.project, args.profile);
  const out = resolve(args.out);
  if (args.check) {
    if (await verifyBuild(out, build)) return 0;
    console.error('cli.output.mismatch');
    return 1;
  }
  if (await exists(out)) throw new TypeError('cli.output.exists');
  await mkdir(dirname(out), { recursive: true });
  const stage = await mkdtemp(join(dirname(out), `.${basename(out)}-iconforge-`));
  try {
    for (const [path, bytes] of Object.entries(build.artifacts)) await writeFile(join(stage, path), bytes, { flag: 'wx' });
    await writeFile(join(stage, 'manifest.json'), build.manifestBytes, { flag: 'wx' });
    if (await exists(out)) throw new TypeError('cli.output.exists');
    await rename(stage, out);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return 0;
}

export async function runCli(argv: string[]): Promise<0 | 1 | 2 | 3> {
  try {
    const args = parseArgs([...argv]);
    return await compileCommand(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof TypeError || error instanceof SyntaxError
      || (error as NodeJS.ErrnoException).code === 'ENOENT' ? 2 : 3;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}

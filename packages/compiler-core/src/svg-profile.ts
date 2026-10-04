import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { assertProject, canonicalJson, type ProjectV1 } from '@iconforge/project-model';
import { serializeIconSvg } from '@iconforge/export-svg';

export const SVG_COMPILER_VERSION = '0.1.0';
const encoder = new TextEncoder();

export interface BuildManifestV1 {
  format: 'iconforge-build';
  formatVersion: 1;
  projectContentSha256: string;
  compilerVersion: string;
  profile: { name: string; optionsSha256: string };
  artifacts: { path: string; sha256: string; bytes: number }[];
}

export interface SvgProfileBuild {
  artifacts: Record<string, Uint8Array>;
  manifest: BuildManifestV1;
  manifestBytes: Uint8Array;
}

function hash(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }

/** Pure compile query. All paths derive from validated unique icon slugs. */
export function compileSvgProfile(input: ProjectV1, profileName: string): SvgProfileBuild {
  const project = assertProject(input);
  const matching = project.exportProfiles.filter(candidate => candidate.name === profileName);
  if (matching.length > 1) throw new TypeError('compile.profile.ambiguous');
  const profile = matching[0];
  if (!profile) throw new TypeError('compile.profile.not-found');
  if (profile.target !== 'svg') throw new TypeError('compile.profile.unsupported');
  const artifacts: Record<string, Uint8Array> = {};
  const descriptors: BuildManifestV1['artifacts'] = [];
  for (const icon of [...project.icons].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = `${icon.name}.svg`;
    const bytes = encoder.encode(serializeIconSvg(project, icon, profile.options));
    artifacts[path] = bytes;
    descriptors.push({ path, sha256: hash(bytes), bytes: bytes.length });
  }
  const manifest: BuildManifestV1 = {
    format: 'iconforge-build', formatVersion: 1,
    projectContentSha256: hash(encoder.encode(canonicalJson(project))),
    compilerVersion: SVG_COMPILER_VERSION,
    profile: { name: profile.name, optionsSha256: hash(encoder.encode(canonicalJson(profile.options))) },
    artifacts: descriptors,
  };
  return { artifacts, manifest, manifestBytes: encoder.encode(canonicalJson(manifest)) };
}

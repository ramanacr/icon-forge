import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { assertProject, canonicalJson, canonicalNumber, type ProjectV1 } from '@iconforge/project-model';
import { serializeIconSvg } from '@iconforge/export-svg';
import { SVG_COMPILER_VERSION, type BuildManifestV1, type SvgProfileBuild } from './svg-profile.js';

const encoder = new TextEncoder();
const hash = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

/** Build a deterministic external SVG sprite from the same canonical SVG serializer as individual icons. */
export function compileSpriteProfile(input: ProjectV1, profileName: string): SvgProfileBuild {
  const project = assertProject(input);
  const matching = project.exportProfiles.filter(candidate => candidate.name === profileName);
  if (matching.length > 1) throw new TypeError('compile.profile.ambiguous');
  const profile = matching[0];
  if (!profile) throw new TypeError('compile.profile.not-found');
  if (profile.target !== 'sprite') throw new TypeError('compile.profile.unsupported');

  const symbols: string[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const addSymbol = (icon: ProjectV1['icons'][number], name: string, variantId?: string): void => {
    const id = `${profile.options.idPrefix}${name}`;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id)) throw new TypeError('sprite.id-invalid');
    if (seen.has(id)) throw new TypeError('sprite.id-collision');
    seen.add(id);
    ids.push(id);
    const svg = serializeIconSvg(project, icon, {
      precision: profile.options.precision, sizeAttrs: false, paintMode: 'currentColor', metadata: false,
      ...(variantId ? { variantId } : {}),
    });
    const body = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
    const viewBox = icon.viewBox.map(canonicalNumber).join(' ');
    symbols.push(`<symbol id="${id}" viewBox="${viewBox}">${body}</symbol>`);
  };
  const byName = (a: { name: string }, b: { name: string }): number => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  for (const icon of [...project.icons].sort(byName)) {
    addSymbol(icon, icon.name);
    for (const variant of [...icon.variants].sort(byName)) {
      addSymbol(icon, `${icon.name}-${variant.name}`, variant.id);
    }
  }
  const artifacts: Record<string, Uint8Array> = {
    'sprite.svg': encoder.encode(`<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`),
    'usage.html': encoder.encode(`<!doctype html><html lang="en"><meta charset="utf-8"><title>IconForge sprite usage</title><body>${ids.map(id => `<p><svg role="img" aria-label="${id}"><use href="sprite.svg#${id}"></use></svg> ${id}</p>`).join('')}</body></html>\n`),
  };
  const descriptors: BuildManifestV1['artifacts'] = Object.entries(artifacts)
    .map(([path, bytes]) => ({ path, sha256: hash(bytes), bytes: bytes.length }));
  const manifest: BuildManifestV1 = {
    format: 'iconforge-build', formatVersion: 1,
    projectContentSha256: hash(encoder.encode(canonicalJson(project))),
    compilerVersion: SVG_COMPILER_VERSION,
    profile: { name: profile.name, optionsSha256: hash(encoder.encode(canonicalJson(profile.options))) },
    artifacts: descriptors,
  };
  return { artifacts, manifest, manifestBytes: encoder.encode(canonicalJson(manifest)) };
}

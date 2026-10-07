/** Original IconForge starter shapes, distributed under the repository MIT license. */
export const STARTER_ICONS = [
  { name: 'home', label: 'Home', body: '<path d="M3 11L12 4L21 11V20H14V14H10V20H3Z"/>' },
  { name: 'search', label: 'Search', body: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>' },
  { name: 'plus', label: 'Plus', body: '<path d="M12 4V20M4 12H20"/>' },
  { name: 'check', label: 'Check', body: '<path d="M4 12L9.5 17.5L20 6"/>' },
  { name: 'arrow-right', label: 'Arrow right', body: '<path d="M4 12H20M14 6L20 12L14 18"/>' },
] as const;

export type StarterIconName = typeof STARTER_ICONS[number]['name'];

export function starterSvg(name: StarterIconName): string {
  const icon = STARTER_ICONS.find(candidate => candidate.name === name);
  if (!icon) throw new TypeError('starter.not-found');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#17233d" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icon.body}</svg>`;
}

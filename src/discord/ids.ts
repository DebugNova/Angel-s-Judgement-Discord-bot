/**
 * Custom ID scheme: "<namespace>:<action>:<arg>…". IDs only route an interaction — every handler
 * re-validates the user and the current database state before acting (never trust a custom ID).
 */
export const Ids = {
  challenge: {
    accept: (id: string) => `ch:acc:${id}`,
    decline: (id: string) => `ch:dec:${id}`,
    cancel: (id: string) => `ch:can:${id}`,
  },
  match: {
    link: (id: string) => `m:link:${id}`,
    linkModal: (id: string) => `m:linkmd:${id}`,
    report: (id: string) => `m:rep:${id}`,
    reportSelect: (id: string) => `m:repsel:${id}`,
    confirm: (id: string) => `m:conf:${id}`,
    dispute: (id: string) => `m:disp:${id}`,
    cancelRequest: (id: string) => `m:creq:${id}`,
    cancelAgree: (id: string) => `m:cyes:${id}`,
    cancelRefuse: (id: string) => `m:cno:${id}`,
  },
  referee: {
    review: (id: string) => `r:rev:${id}`,
    award: (id: string, playerId: string, mode: 'd' | 'f') => `r:aw:${id}:${playerId}:${mode}`,
    confirmAward: (id: string, playerId: string, mode: 'd' | 'f') => `r:ok:${id}:${playerId}:${mode}`,
    reasonModal: (id: string, playerId: string, mode: 'd' | 'f') => `r:rs:${id}:${playerId}:${mode}`,
    cancel: (id: string) => `r:can:${id}`,
    confirmCancel: (id: string) => `r:canok:${id}`,
    cancelModal: (id: string) => `r:canrs:${id}`,
    evidence: (id: string) => `r:ev:${id}`,
  },
  page: {
    leaderboard: (type: string, size: number, page: number, owner: string) =>
      `lb:${type}:${size}:${page}:${owner}`,
    history: (target: string, limit: number, page: number, owner: string) =>
      `h:${target}:${limit}:${page}:${owner}`,
    search: (encoded: string, page: number, owner: string) => `ms:${encoded}:${page}:${owner}`,
  },
  help: 'help:sel',
  dismiss: 'x:dismiss',
  config: {
    roles: (kind: string) => `cfg:roles:${kind}`,
  },
  mod: {
    /** Confirm / cancel a pending action. The token points at an in-memory request that expires. */
    confirm: (token: string) => `mod:ok:${token}`,
    cancel: (token: string) => `mod:no:${token}`,
    stopJob: (guildId: string) => `mod:stop:${guildId}`,
    record: (targetId: string, page: number, owner: string) => `mod:rec:${targetId}:${page}:${owner}`,
  },
  music: {
    /** Player panel buttons: back, toggle, skip, stop, shuffle, loop, vdown, vup, queue. */
    control: (action: string) => `mu:${action}`,
    queuePage: (page: number, owner: string) => `mu:qp:${page}:${owner}`,
    queueJump: (owner: string) => `mu:qj:${owner}`,
    pick: (token: string) => `mu:pick:${token}`,
  },
  reset: {
    proceed: (scope: string, playerId: string, del: boolean) => `rs:go:${scope}:${playerId}:${del ? 1 : 0}`,
    modal: (scope: string, playerId: string, del: boolean) => `rs:md:${scope}:${playerId}:${del ? 1 : 0}`,
  },
} as const;

export function parseId(customId: string): { ns: string; action: string; args: string[] } {
  const [ns = '', action = '', ...args] = customId.split(':');
  return { ns, action, args };
}

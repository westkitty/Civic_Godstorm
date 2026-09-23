import { describe, expect, it } from 'vitest';
import { GameSession, replayCommandLog } from '../../src/runtime/session.ts';
import { makeGodCommand, ownGod } from '../../src/ui/godView.ts';

describe('game session', () => {
  it('issues ordinary commands whose log replays headlessly to identical hashes', () => {
    const session = new GameSession({ seed: 'cg-demo', size: 'small', civCount: 2 });
    let snapshot = session.getSnapshot();
    const god = ownGod(snapshot.view);
    if (!god) throw new Error('no god');
    session.addDraft(makeGodCommand(snapshot.view, god, session.nextSequence(), { kind: 'GOD_MOVE', options: { waypoints: [804], routeMode: 'DIRECT', then: 'FEED' }, consent: {} }));
    for (let turn = 0; turn < 4; turn += 1) session.endTurn();
    snapshot = session.getSnapshot();
    session.addDraft(makeGodCommand(snapshot.view, god, session.nextSequence(), { kind: 'GOD_REST' }));
    session.endTurn();
    const log = session.exportLog();
    expect(log.turns.flatMap((t) => t.rejections)).toEqual([]);
    const hashes = replayCommandLog(log);
    expect(hashes[0]).toBe(log.initialHash);
    expect(hashes.slice(1)).toEqual(log.turns.map((t) => t.stateHash));
  });

  it('replaces an earlier God order draft with a later one for the same God', () => {
    const session = new GameSession({ seed: 'cg-demo', size: 'small', civCount: 2 });
    const { view } = session.getSnapshot();
    const god = ownGod(view);
    if (!god) throw new Error('no god');
    session.addDraft(makeGodCommand(view, god, session.nextSequence(), { kind: 'GOD_FEED' }));
    session.addDraft(makeGodCommand(view, god, session.nextSequence(), { kind: 'GOD_REST' }));
    session.addDraft(makeGodCommand(view, god, session.nextSequence(), { kind: 'GOD_STANCE', options: { stance: 'CAREFUL' } }));
    expect(session.getSnapshot().drafts.map((d) => d.kind)).toEqual(['GOD_REST', 'GOD_STANCE']);
  });
});

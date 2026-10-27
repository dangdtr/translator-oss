import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/core/subtitles';

test('SRT: BOM, CRLF, multiple lines, comma fractions and HTML', () => {
  assert.deepEqual(
    S.parse(
      '\uFEFF1\r\n00:01:02,500 --> 00:01:05,750\r\n<b>Hello</b>\r\nworld &amp; friends\r\n',
    ),
    [{ start: 62.5, end: 65.75, text: 'Hello world & friends' }],
  );
});

test('VTT: identifiers, cue settings and short timestamps', () => {
  assert.deepEqual(
    S.parse('WEBVTT\n\nintro\n00:01.000 --> 00:03.500 align:start\nHello\n\n'),
    [{ start: 1, end: 3.5, text: 'Hello' }],
  );
});

test('Bad ranges and blank cues cannot enter scheduler', () => {
  assert.deepEqual(
    S.normalize([
      { start: 5, end: 3, text: 'bad' },
      { start: NaN, end: 8, text: 'bad' },
      { start: -1, end: 2, text: 'bad' },
      { start: 0, end: 1, text: ' ' },
    ]),
    [],
  );
});

test('Cue selection handles gaps, boundaries and seeking backwards', () => {
  const cues = [
    { start: 1, end: 3, text: 'a' },
    { start: 4, end: 6, text: 'b' },
  ];
  assert.equal(S.indexAt(cues, 0), -1);
  assert.equal(S.indexAt(cues, 1), 0);
  assert.equal(S.indexAt(cues, 3), -1);
  assert.equal(S.indexAt(cues, 5), 1);
  assert.equal(S.indexAt(cues, 2), 0);
  assert.equal(S.indexAt(cues, 6), -1);
});

test('YouTube JSON3 combines timed segments and ignores events without speech', () => {
  assert.deepEqual(
    S.json3({
      events: [
        { tStartMs: 0 },
        {
          tStartMs: 1200,
          dDurationMs: 2000,
          segs: [{ utf8: 'Hello ' }, { utf8: 'world' }],
        },
      ],
    }),
    [{ start: 1.2, end: 3.2, text: 'Hello world' }],
  );
});

test('Sentences: caption fragments join up to sentence-ending punctuation', () => {
  const units = S.sentences([
    { start: 0, end: 2, text: 'In this course, you will learn how to communicate' },
    {
      start: 2,
      end: 4.5,
      text: 'the value of the AWS Cloud to non-technical stakeholders.',
    },
    { start: 4.6, end: 6, text: '"Ready?"' },
    { start: 6.1, end: 8, text: 'Amazon EC2 provides compute capacity' },
  ]);
  assert.deepEqual(
    units.map(u => [u.start, u.end, u.cues]),
    [
      [0, 4.5, [0, 1]],
      [4.6, 6, [2]],
      [6.1, 8, [3]],
    ],
  );
  assert.equal(
    units[0].text,
    'In this course, you will learn how to communicate the value of the AWS Cloud to non-technical stakeholders.',
  );
});

test('Sentences: gaps, duration, length and line count bound unpunctuated captions', () => {
  const words = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 1.9,
      text: 'word ' + i,
    }));
  assert.deepEqual(
    S.sentences(words(8)).map(u => u.cues.length),
    [6, 2],
  );
  assert.deepEqual(
    S.sentences([
      { start: 0, end: 1, text: 'a' },
      { start: 3, end: 4, text: 'b' },
    ]).map(u => u.cues),
    [[0], [1]],
  );
  assert.deepEqual(
    S.sentences([
      { start: 0, end: 8, text: 'a' },
      { start: 8, end: 14, text: 'b' },
    ]).map(u => u.cues),
    [[0], [1]],
  );
  assert.deepEqual(
    S.sentences([
      { start: 0, end: 1, text: 'x'.repeat(300) },
      { start: 1, end: 2, text: 'y'.repeat(30) },
    ]).map(u => u.cues),
    [[0], [1]],
  );
  assert.deepEqual(S.sentences([]), []);
});

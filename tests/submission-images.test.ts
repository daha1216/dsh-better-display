import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submissionImages } from '../src/client/submission-images.ts';

test('reads the 0.1.x `images` shape', () => {
  assert.deepEqual(
    submissionImages({ images: [{ previewUrl: 'blob:a', name: 'a.png', width: 640, height: 480 }] }),
    [{ previewUrl: 'blob:a', name: 'a.png', width: 640, height: 480 }],
  );
});

test('reads the 0.2.x tagged `attachments` union and drops file branches', () => {
  assert.deepEqual(
    submissionImages({
      attachments: [
        { type: 'image', value: { previewUrl: 'blob:b', name: 'b.png' } },
        { type: 'file', value: { receiptId: 'r1' } },
      ],
    }),
    [{ previewUrl: 'blob:b', name: 'b.png' }],
  );
});

test('prefers `images` when an echo somehow carries both fields', () => {
  assert.deepEqual(
    submissionImages({
      images: [{ previewUrl: 'blob:old' }],
      attachments: [{ type: 'image', value: { previewUrl: 'blob:new' } }],
    }),
    [{ previewUrl: 'blob:old' }],
  );
});

test('empties out on missing, empty and malformed input', () => {
  assert.deepEqual(submissionImages(undefined), []);
  assert.deepEqual(submissionImages({}), []);
  assert.deepEqual(submissionImages({ images: [] }), []);
  assert.deepEqual(submissionImages({ images: [null, 'x', { previewUrl: '' }] }), []);
});

test('omits a non-string name and non-finite dimensions instead of carrying junk', () => {
  assert.deepEqual(
    submissionImages({ images: [{ previewUrl: 'blob:c', name: 7, width: Number.NaN, height: Infinity }] }),
    [{ previewUrl: 'blob:c' }],
  );
});

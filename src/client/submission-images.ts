/**
 * Image previews carried by a local submission echo.
 *
 * The field name is the part that moves between peer versions: 0.1.x snapshots
 * expose `PendingSubmission.images` (bare `{previewUrl,name,width,height}`),
 * while 0.2.x exposes `PendingSubmission.attachments` as a tagged union
 * (`{type:'image',value:…} | {type:'file',value:…}`) that also carries durable
 * file metadata. Reading through this helper keeps the reader working on both
 * shapes instead of hard-coding whichever peer version happened to be installed
 * at build time.
 *
 * The bundle carries an identical `submissionImages` (this fork ships
 * `lib/client.js` by hand); keep the two in step.
 */
export interface SubmissionImagePreview {
  previewUrl: string;
  name?: string;
  width?: number;
  height?: number;
}

type RawPreview = Partial<Record<'previewUrl' | 'name' | 'width' | 'height', unknown>>;

export function submissionImages(submission: unknown): SubmissionImagePreview[] {
  const record = submission as { images?: unknown; attachments?: unknown } | null | undefined;
  const list: readonly unknown[] = Array.isArray(record?.images)
    ? record.images
    : Array.isArray(record?.attachments)
      ? record.attachments.filter(item => (item as { type?: unknown } | null)?.type === 'image')
      : [];
  const images: SubmissionImagePreview[] = [];
  for (const item of list) {
    const wrapped = item as { value?: RawPreview } | null;
    const candidate: RawPreview | null | undefined = wrapped?.value !== undefined ? wrapped.value : item as RawPreview;
    if (typeof candidate?.previewUrl !== 'string' || candidate.previewUrl === '') continue;
    images.push({
      previewUrl: candidate.previewUrl,
      ...typeof candidate.name === 'string' && candidate.name !== '' ? { name: candidate.name } : {},
      ...typeof candidate.width === 'number' && Number.isFinite(candidate.width) ? { width: candidate.width } : {},
      ...typeof candidate.height === 'number' && Number.isFinite(candidate.height) ? { height: candidate.height } : {},
    });
  }
  return images;
}

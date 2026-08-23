import { ContentFormat } from '@dailydotdev/schema';
import type { TypedWorker } from './worker';
import { PostType } from '../entity/posts/Post';
import { Source } from '../entity/Source';
import {
  extractAndFileClaims,
  isCoveredByOtherLane,
  loadFiledStatements,
} from '../common/claimExtraction';
import {
  isTwitterSocialType,
  mapTwitterSocialPayload,
} from '../common/twitterSocial';
import type { Data } from './postUpdated/types';

// Only articles are cleaned into XML, so requiring one dropped every other type
// the triage flagged — which is what kept the ledger article-only for its first
// year. The rest still have text, just somewhere else: YouTube captions are
// scraped into their own GCS bucket as plain text, while tweets and collections
// carry theirs on the payload. Freeform is deliberately excluded: squad posts
// can be private, and the ledger has no privacy model yet.
const inlineTextTypes: string[] = [PostType.SocialTwitter, PostType.Collection];

const resolveInlineText = (
  data: Data,
): { title: string; content: string } | null => {
  if (!inlineTextTypes.includes(data.content_type ?? '')) {
    return null;
  }

  if (!isTwitterSocialType(data.content_type)) {
    const content = data.extra?.content?.trim();

    return content ? { title: data.title ?? '', content } : null;
  }

  try {
    // A thread keeps its root tweet in the title and the rest in content, so
    // the shared mapper is the only place that reassembles the whole text.
    const { fields } = mapTwitterSocialPayload({ data });
    const content = fields.content?.trim() || fields.title?.trim();

    return content ? { title: fields.title ?? '', content } : null;
  } catch {
    // postUpdated maps the same payload and fails loudly on it, so a malformed
    // tweet has no post to attach claims to either way.
    return null;
  }
};

type ContentSource = {
  uri: string | null;
  content: string | null;
  title: string;
  contentFormat: ContentFormat;
};

const resolveContentSource = (data: Data): ContentSource | null => {
  const cleaned = data.meta?.cleaned?.[0]?.resource_location;

  if (cleaned?.startsWith('gs://')) {
    return {
      uri: cleaned,
      content: null,
      title: data.title ?? '',
      contentFormat: ContentFormat.XML,
    };
  }

  // Only for video: the article scrape under the same key is raw page HTML,
  // which bragi would have to clean again — the cleaned XML above is better.
  const scraped = data.meta?.scraped?.resource_location;

  if (
    data.content_type === PostType.VideoYouTube &&
    scraped?.startsWith('gs://')
  ) {
    return {
      uri: scraped,
      content: null,
      title: data.title ?? '',
      contentFormat: ContentFormat.Markdown,
    };
  }

  const inline = resolveInlineText(data);

  return inline
    ? { uri: null, ...inline, contentFormat: ContentFormat.Markdown }
    : null;
};

const worker: TypedWorker<'yggdrasil.v1.content-published'> = {
  subscription: 'api.content-published-extract-claims',
  handler: async ({ data, messageId }, con, logger): Promise<void> => {
    // Absent until yggdrasil maps bragi's triage fields onto the payload.
    if (data.meta?.change_signal !== 'clear') {
      return;
    }

    const postId = data.post_id;
    const contentSource = resolveContentSource(data);

    if (!postId || !contentSource) {
      return;
    }

    const target = { postId };
    // The topic fires on updates and Pub/Sub redelivers, so extraction is
    // frozen at first sight of a post — re-extracting is an explicit operation
    // over the private ledger routes. Checked before the GCS fetch so repeat
    // deliveries cost nothing.
    const filed = await loadFiledStatements({ con, target });

    if (filed.length) {
      return;
    }

    if (
      data.url &&
      (await isCoveredByOtherLane({ con, target, url: data.url }))
    ) {
      return;
    }

    const source = data.source_id
      ? await con
          .getRepository(Source)
          .findOne({ select: ['name'], where: { id: data.source_id } })
      : null;

    await extractAndFileClaims({
      con,
      logger,
      target,
      filed: [],
      ...contentSource,
      url: data.url,
      source: source?.name ?? data.source_id ?? '',
      publishedAt: data.published_at ? new Date(data.published_at) : null,
      logDetails: { postId, messageId },
    });
  },
};

export default worker;

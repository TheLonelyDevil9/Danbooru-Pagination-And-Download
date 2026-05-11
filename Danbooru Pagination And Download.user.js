// ==UserScript==
// @name         Danbooru Pagination And Download
// @namespace    https://danbooru.donmai.us/
// @version      2.5.0
// @description  Load 10 Danbooru post-list pages at once and add one-click original download buttons to listing thumbnails and post images.
// @match        https://danbooru.donmai.us/*
// @run-at       document-end
// @noframes
// @grant        GM_download
// @grant        GM.download
// @connect      danbooru.donmai.us
// @connect      cdn.donmai.us
// @connect      *.donmai.us
// ==/UserScript==

(function () {
  "use strict";

  const PAGE_BATCH_SIZE = 10;
  const PAGE_BUTTON_CLASS = "dcx-post-download";
  const PAGE_ACTIONS_CLASS = "dcx-post-actions";
  const SCORE_ACTIONS_CLASS = "dcx-score-actions";
  const SHOW_BUTTON_CLASS = "dcx-original-download";
  const SHOW_ACTIONS_CLASS = "dcx-image-actions";
  const STYLE_ID = "dcx-danbooru-tools-style";
  const LOADING_ID = "dcx-batch-loading";

  let postPageOverlayPending = false;
  let indexBatchStarted = false;
  let lastMiddleOpenUrl = "";
  let lastMiddleOpenAt = 0;
  const originalUrlByPostId = new Map();
  const filenameByPostId = new Map();

  function addStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${PAGE_BUTTON_CLASS},
      .${SHOW_BUTTON_CLASS} {
        width: 46px;
        height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(220, 232, 238, 0.34);
        border-radius: 8px;
        background: rgba(18, 20, 29, 0.78);
        color: rgb(235, 243, 247);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38);
        cursor: pointer;
        text-decoration: none;
        line-height: 1;
        opacity: 0.82;
        backdrop-filter: blur(4px);
        transition: opacity 120ms ease-out, transform 120ms ease-out, background-color 120ms ease-out;
      }

      .post-preview-score .${PAGE_BUTTON_CLASS} {
        width: 44px;
        height: 44px;
        flex: 0 0 44px;
        border-radius: 7px;
      }

      .${PAGE_BUTTON_CLASS}:hover,
      .${PAGE_BUTTON_CLASS}:focus-visible,
      .${SHOW_BUTTON_CLASS}:hover,
      .${SHOW_BUTTON_CLASS}:focus-visible {
        opacity: 1;
        transform: translateY(-1px);
        background: rgba(0, 126, 166, 0.92);
        color: rgb(241, 249, 252);
        text-decoration: none;
      }

      .${PAGE_BUTTON_CLASS}:focus-visible,
      .${SHOW_BUTTON_CLASS}:focus-visible {
        outline: 2px solid rgb(71, 213, 255);
        outline-offset: 2px;
      }

      .${PAGE_BUTTON_CLASS}::before,
      .${SHOW_BUTTON_CLASS}::before {
        content: "\\2193";
        font: 700 31px/1 Arial, sans-serif;
        transform: translateY(-2px);
      }

      .post-preview-score .${PAGE_BUTTON_CLASS}::before {
        font-size: 29px;
      }

      .${PAGE_ACTIONS_CLASS} {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 52px;
        margin-top: 7px;
      }

      .${SHOW_ACTIONS_CLASS} {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        min-height: 52px;
        margin-top: 7px;
        margin-bottom: 8px;
        box-sizing: border-box;
      }

      .${PAGE_BUTTON_CLASS} {
        position: static;
      }

      .${SHOW_BUTTON_CLASS} {
        position: static;
      }

      #${LOADING_ID} {
        margin: 1rem 0 0;
        text-align: center;
        color: var(--muted-text-color, rgb(175, 184, 190));
        font-size: var(--text-sm, 0.875rem);
      }

      .post-preview-container + .${PAGE_ACTIONS_CLASS} {
        margin-bottom: 0;
      }

      .post-preview-score.${SCORE_ACTIONS_CLASS} {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 44px;
        align-items: center;
        column-gap: 6px;
      }

      .post-preview-score.${SCORE_ACTIONS_CLASS} .post-votes {
        grid-column: 2;
        justify-self: center;
      }

      .post-preview-score.${SCORE_ACTIONS_CLASS} .${PAGE_BUTTON_CLASS} {
        grid-column: 3;
        justify-self: end;
      }

      .blacklisted-hidden .${PAGE_BUTTON_CLASS},
      .blacklisted-blurred .${PAGE_BUTTON_CLASS} {
        display: none;
      }
    `;

    document.head.append(style);
  }

  function isPostsIndexPage() {
    return location.pathname === "/posts" || location.pathname === "/posts/";
  }

  function isPostShowPage() {
    return /^\/posts\/\d+/.test(location.pathname);
  }

  function currentUrl() {
    return new URL(location.href);
  }

  function getCurrentPage() {
    const current = document.querySelector(".paginator-current");
    const currentPage = Number.parseInt(current?.textContent?.trim() || "", 10);

    if (Number.isFinite(currentPage) && currentPage > 0) {
      return currentPage;
    }

    const urlPage = Number.parseInt(currentUrl().searchParams.get("page") || "", 10);
    return Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1;
  }

  function pageUrl(page, base = currentUrl()) {
    const url = new URL(base.href);
    url.searchParams.set("page", String(Math.max(1, page)));
    return url.pathname + url.search + url.hash;
  }

  function jsonPageUrl(page) {
    const url = currentUrl();
    url.pathname = "/posts.json";
    url.searchParams.set("page", String(Math.max(1, page)));
    return url.pathname + url.search;
  }

  function makeAbsoluteUrl(url) {
    if (!url) {
      return "";
    }

    try {
      return new URL(url, location.href).href;
    } catch (_error) {
      return url;
    }
  }

  function stripDownloadParam(url) {
    try {
      const parsed = new URL(url, location.href);
      parsed.searchParams.delete("download");
      return parsed.href;
    } catch (_error) {
      return url;
    }
  }

  function addDownloadParam(url) {
    const parsed = new URL(url, location.href);
    parsed.searchParams.set("download", "1");
    return parsed.href;
  }

  function filenameFromUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      const filename = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
      return filename || undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function extensionFromFilename(filename) {
    return filename?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
  }

  function isMd5Filename(filename) {
    return /^[a-f0-9]{32}\.[a-z0-9]+$/i.test(filename || "");
  }

  function cleanFilenamePart(value) {
    return (value || "")
      .trim()
      .toLowerCase()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_{2,}/g, "_");
  }

  function cleanDownloadName(filename) {
    return (filename || "")
      .trim()
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, "_");
  }

  function slugFromTags(tags) {
    const meaningfulTags = (tags || "")
      .split(/\s+/)
      .filter((tag) => tag && !tag.includes(":"))
      .slice(0, 8);

    return meaningfulTags
      .join("_")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_{2,}/g, "_");
  }

  function tagList(value) {
    return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
  }

  function unqualifiedTagName(tag) {
    return tag.replace(/_\(.*\)$/, "");
  }

  function humanizedList(items) {
    if (items.length <= 1) {
      return items[0] || "";
    }

    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }

    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
  }

  function essentialTagSlug(post) {
    const characters = tagList(post?.tag_string_character).map(unqualifiedTagName);
    const copyrights = tagList(post?.tag_string_copyright).map(unqualifiedTagName);
    const artists = tagList(post?.tag_string_artist);
    const parts = [];

    if (characters.length > 0) {
      const shownCharacters = characters.slice(0, 5);
      if (characters.length > 5) {
        shownCharacters.push(`${characters.length - 5} more`);
      }

      parts.push(humanizedList(shownCharacters));
    }

    if (copyrights.length > 0) {
      const shownCopyrights = copyrights.slice(0, 1);
      if (copyrights.length > 1) {
        shownCopyrights.push(`${copyrights.length - 1} more`);
      }

      const copyrightText = humanizedList(shownCopyrights);
      parts.push(characters.length > 0 ? `(${copyrightText})` : copyrightText);
    }

    if (artists.length > 0) {
      parts.push(`drawn by ${humanizedList(artists)}`);
    }

    return parts.join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_{2,}/g, "_");
  }

  function taggedFilenameFromParts(slug, md5, ext) {
    const cleanSlug = slug.replace(/^_+|_+$/g, "");
    return cleanSlug ? `__${cleanSlug}__${md5}.${ext}` : `${md5}.${ext}`;
  }

  function taggedUrlFromPost(post, fallbackUrl) {
    const md5 = post?.md5 || filenameFromUrl(fallbackUrl)?.match(/[a-f0-9]{32}/i)?.[0] || "";
    const ext = post?.file_ext || extensionFromFilename(filenameFromUrl(fallbackUrl));
    const slug = essentialTagSlug(post) || slugFromTags(tagStringFromPost(post));

    if (!slug || !md5 || !ext) {
      return fallbackUrl;
    }

    try {
      const parsed = new URL(fallbackUrl, location.href);
      const parts = parsed.pathname.split("/");
      const filename = parts.pop() || "";

      if (/^[a-f0-9]{32}\.[a-z0-9]+$/i.test(filename)) {
        parts.push(taggedFilenameFromParts(slug, md5, ext));
        parsed.pathname = parts.join("/");
        return parsed.href;
      }
    } catch (_error) {
      return fallbackUrl;
    }

    return fallbackUrl;
  }

  function taggedDownloadName(post, originalUrl) {
    const md5 = post?.md5 || filenameFromUrl(originalUrl)?.match(/[a-f0-9]{32}/i)?.[0] || "";
    const ext = post?.file_ext || extensionFromFilename(filenameFromUrl(originalUrl)) || "file";
    const slug =
      post?.media_asset?.metadata?.metadata?.slug ||
      post?.media_asset?.metadata?.slug ||
      essentialTagSlug(post) ||
      slugFromTags(tagStringFromPost(post));

    if (slug && md5) {
      return taggedFilenameFromParts(cleanFilenamePart(slug), md5, ext);
    }

    return cleanDownloadName(filenameFromUrl(originalUrl)) || (post?.id ? `danbooru-${post.id}.${ext}` : undefined);
  }

  function rememberPost(post) {
    if (!post?.id || !post?.file_url) {
      return;
    }

    const postId = String(post.id);
    const rawOriginalUrl = stripDownloadParam(makeAbsoluteUrl(post.file_url));
    const originalUrl = taggedUrlFromPost(post, rawOriginalUrl);
    originalUrlByPostId.set(postId, originalUrl);
    filenameByPostId.set(postId, taggedDownloadName(post, originalUrl) || `danbooru-${postId}.${post.file_ext || "file"}`);
  }

  function tagStringFromPost(post) {
    if (typeof post.tag_string === "string") {
      return post.tag_string;
    }

    if (post.tag_string && typeof post.tag_string === "object") {
      return Object.values(post.tag_string).filter(Boolean).join(" ");
    }

    return "";
  }

  function statusFlagsFromPost(post) {
    const flags = [];

    if (post.is_pending) {
      flags.push("pending");
    }

    if (post.is_flagged) {
      flags.push("flagged");
    }

    if (post.is_deleted) {
      flags.push("deleted");
    }

    if (post.is_banned) {
      flags.push("banned");
    }

    return flags.join(" ");
  }

  function previewClassFromPost(post, size) {
    const classes = [
      "post-preview",
      "post-preview-fit-compact",
      `post-preview-${size}`,
    ];

    if (post.is_pending) {
      classes.push("post-status-pending");
    }

    if (post.is_flagged) {
      classes.push("post-status-flagged");
    }

    if (post.is_deleted) {
      classes.push("post-status-deleted");
    }

    if (post.parent_id) {
      classes.push("post-status-has-parent");
    }

    if (post.has_visible_children) {
      classes.push("post-status-has-children");
    }

    if (document.querySelector(".post-preview-show-votes")) {
      classes.push("post-preview-show-votes");
    }

    return classes.join(" ");
  }

  function pickPreviewUrl(post) {
    const variants = post.media_asset?.variants || post.media_asset?.media_variants || [];
    const preferredVariant = Array.isArray(variants)
      ? variants.find((variant) => /(?:720|large)/i.test(variant.type || variant.name || "")) ||
        variants.find((variant) => /(?:360|preview|sample)/i.test(variant.type || variant.name || "")) ||
        variants[0]
      : null;

    return makeAbsoluteUrl(
      post.media_asset?.variants?.["720x720"]?.file_url ||
      post.media_asset?.variants?.["360x360"]?.file_url ||
      post.media_asset?.variants?.["180x180"]?.file_url ||
      post.media_asset?.variants?.["720x720"]?.url ||
      post.media_asset?.variants?.["360x360"]?.url ||
      post.media_asset?.variants?.["180x180"]?.url ||
      post.large_file_url ||
      post.sample_url ||
      post.preview_file_url ||
      post.preview_url ||
      post.media_asset?.large_file_url ||
      post.media_asset?.sample_url ||
      post.media_asset?.preview_file_url ||
      post.media_asset?.preview_url ||
      preferredVariant?.url ||
      preferredVariant?.file_url ||
      post.file_url ||
      ""
    );
  }

  function markExistingPagePosts(page) {
    document.querySelectorAll("article.post-preview[data-id]:not([data-dcx-loaded-page])").forEach((post) => {
      post.dataset.dcxLoadedPage = String(page);
    });
  }

  function currentSearchTags() {
    const params = currentUrl().searchParams;
    return params.get("tags") || params.get("q") || "";
  }

  function postPageHref(post) {
    const url = new URL(`/posts/${post.id}`, location.origin);
    const tags = currentSearchTags();

    if (tags) {
      url.searchParams.set("q", tags);
    }

    return url.pathname + url.search;
  }

  function postVotesPath(postId) {
    const url = new URL("/post_votes", location.origin);
    url.searchParams.set("search[post_id]", String(postId));
    url.searchParams.set("variant", "compact");
    return url.pathname + url.search;
  }

  function makePostPreviewScore(post) {
    const score = document.createElement("div");
    score.className = "post-preview-score text-sm text-center mt-1";

    const votes = document.createElement("span");
    votes.className = "post-votes inline-flex items-center leading-none gap-1";
    votes.dataset.id = String(post.id);

    const upvote = document.createElement("span");
    upvote.className = "post-upvote-link inactive-link";
    upvote.textContent = "\u2191";

    const scoreValue = document.createElement("span");
    scoreValue.className = "post-score inline-block text-center whitespace-nowrap align-middle min-w-4";

    const scoreLink = document.createElement("a");
    scoreLink.href = postVotesPath(post.id);
    scoreLink.rel = "nofollow";
    scoreLink.textContent = String(post.score ?? 0);

    const downvote = document.createElement("span");
    downvote.className = "post-downvote-link inactive-link";
    downvote.textContent = "\u2193";

    scoreValue.append(scoreLink);
    votes.append(upvote, scoreValue, downvote);
    score.append(votes);
    return score;
  }

  function makePostPreviewFromJson(post, page) {
    const previewUrl = pickPreviewUrl(post);
    if (!post?.id || !previewUrl) {
      return null;
    }

    const size = document.querySelector(".post-gallery")?.className.match(/post-gallery-(150|180|225w?|270w?|360|540|720)\b/)?.[1] || "180";
    const article = document.createElement("article");
    const postId = String(post.id);
    const tagString = tagStringFromPost(post);

    article.id = `post_${postId}`;
    article.className = previewClassFromPost(post, size);
    article.dataset.id = postId;
    article.dataset.tags = tagString;
    article.dataset.rating = post.rating || "";
    article.dataset.flags = statusFlagsFromPost(post);
    article.dataset.score = String(post.score ?? 0);
    article.dataset.uploaderId = String(post.uploader_id ?? "");
    article.dataset.dcxLoadedPage = String(page);

    const container = document.createElement("div");
    container.className = "post-preview-container";

    const link = document.createElement("a");
    link.href = postPageHref(post);
    link.className = "post-preview-link";
    link.draggable = false;

    const picture = document.createElement("picture");
    const image = document.createElement("img");
    image.src = previewUrl;
    image.className = "post-preview-image";
    image.alt = `post #${postId}`;
    image.title = `${tagString} rating:${post.rating || ""} score:${post.score ?? 0}`.trim();
    image.draggable = false;

    const previewWidth = post.preview_width || post.media_asset?.preview_width || post.media_asset?.image_width || post.image_width;
    const previewHeight = post.preview_height || post.media_asset?.preview_height || post.media_asset?.image_height || post.image_height;

    if (previewWidth) {
      image.width = previewWidth;
    }

    if (previewHeight) {
      image.height = previewHeight;
    }

    picture.append(image);
    link.append(picture);
    container.append(link);
    article.append(container);

    if (document.querySelector(".post-preview-show-votes")) {
      article.append(makePostPreviewScore(post));
    }

    return article;
  }

  async function fetchJsonPage(page) {
    const response = await fetch(jsonPageUrl(page), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return [];
    }

    const posts = await response.json();
    if (!Array.isArray(posts)) {
      return [];
    }

    posts.forEach(rememberPost);
    return posts;
  }

  function getGalleryContainer(root = document) {
    return root.querySelector(".post-gallery .posts-container");
  }

  function batchPages(startPage) {
    return Array.from({ length: PAGE_BATCH_SIZE }, (_value, index) => startPage + index);
  }

  function normalizeBatchStart(page) {
    return Math.max(1, page);
  }

  function createLoadingNotice(startPage) {
    const existing = document.getElementById(LOADING_ID);
    if (existing) {
      existing.remove();
    }

    const gallery = document.querySelector(".post-gallery");
    if (!gallery) {
      return null;
    }

    const notice = document.createElement("div");
    notice.id = LOADING_ID;
    notice.textContent = `Loading pages ${startPage + 1}-${startPage + PAGE_BATCH_SIZE - 1}...`;
    gallery.append(notice);
    return notice;
  }

  function appendPostsFromJson(posts, page) {
    const target = getGalleryContainer();

    if (!target) {
      return 0;
    }

    let count = 0;
    posts.forEach((post) => {
      const postId = String(post?.id || "");

      if (postId && target.querySelector(`article.post-preview[data-id="${CSS.escape(postId)}"]`)) {
        return;
      }

      const preview = makePostPreviewFromJson(post, page);
      if (!preview) {
        return;
      }

      target.append(preview);
      count += 1;
    });

    return count;
  }

  function reapplyBlacklistForNewPosts() {
    const blacklist = document.querySelector("#blacklist-box")?.blacklist;
    const BlacklistPost = blacklist?.constructor?.Post;

    if (!blacklist || !BlacklistPost) {
      return;
    }

    document.querySelectorAll(".post-preview:not(.blacklist-initialized)").forEach((postElement) => {
      const post = new BlacklistPost(postElement, blacklist);
      blacklist.posts.push(post);
      post.applyRules();
    });
  }

  async function loadBatchPages() {
    if (!isPostsIndexPage() || indexBatchStarted) {
      return;
    }

    const target = getGalleryContainer();
    if (!target) {
      return;
    }

    const startPage = normalizeBatchStart(getCurrentPage());
    indexBatchStarted = true;
    markExistingPagePosts(startPage);

    const pagesToAppend = batchPages(startPage).slice(1);
    const notice = createLoadingNotice(startPage);

    try {
      await fetchJsonPage(startPage);

      const jsonResults = await Promise.allSettled(pagesToAppend.map(async (page) => {
        return { page, posts: await fetchJsonPage(page) };
      }));

      const appendedCount = jsonResults
        .filter((result) => result.status === "fulfilled" && result.value.posts.length > 0)
        .sort((left, right) => left.value.page - right.value.page)
        .reduce((sum, result) => sum + appendPostsFromJson(result.value.posts, result.value.page), 0);

      reapplyBlacklistForNewPosts();
      installListingDownloadButtons();

      if (notice) {
        notice.textContent = appendedCount > 0 ? `Loaded ${PAGE_BATCH_SIZE} pages.` : "No additional posts loaded.";
        window.setTimeout(() => notice.remove(), 1800);
      }
    } catch (_error) {
      if (notice) {
        notice.textContent = "Could not load additional pages.";
      }
    }
  }

  function rewriteBatchPagination() {
    if (!isPostsIndexPage()) {
      return;
    }

    const currentPage = getCurrentPage();
    const previousBatchPage = Math.max(1, currentPage - PAGE_BATCH_SIZE);
    const nextBatchPage = currentPage + PAGE_BATCH_SIZE;

    document.querySelectorAll(".paginator").forEach((paginator) => {
      const previous = paginator.querySelector("a.paginator-prev");
      const next = paginator.querySelector("a.paginator-next");

      if (previous) {
        previous.href = pageUrl(previousBatchPage);
        previous.title = `Previous ${PAGE_BATCH_SIZE}-page batch`;
        previous.setAttribute("aria-label", `Previous ${PAGE_BATCH_SIZE}-page batch`);
      }

      if (next) {
        next.href = pageUrl(nextBatchPage);
        next.title = `Next ${PAGE_BATCH_SIZE}-page batch`;
        next.setAttribute("aria-label", `Next ${PAGE_BATCH_SIZE}-page batch`);
      }
    });
  }

  function postIdFromPreview(preview) {
    return preview?.dataset?.id || preview?.id?.match(/^post_(\d+)$/)?.[1] || "";
  }

  function getListingOriginalUrl(preview) {
    const postId = postIdFromPreview(preview);
    return postId ? originalUrlByPostId.get(postId) || "" : "";
  }

  function getListingDownloadName(preview, originalUrl) {
    const postId = postIdFromPreview(preview);
    return cleanDownloadName((postId && filenameByPostId.get(postId)) || filenameFromUrl(originalUrl)) || `danbooru-${postId || "original"}`;
  }

  function getListingActionContainer(preview, previewContainer) {
    const score = preview.querySelector(".post-preview-score");
    if (score) {
      score.classList.add(SCORE_ACTIONS_CLASS);
      return score;
    }

    let actions = preview.querySelector(`.${PAGE_ACTIONS_CLASS}`);
    if (!actions) {
      actions = document.createElement("div");
      actions.className = PAGE_ACTIONS_CLASS;
      previewContainer.after(actions);
    }

    return actions;
  }

  function installListingDownloadButtons() {
    if (!isPostsIndexPage()) {
      return;
    }

    document.querySelectorAll("article.post-preview[data-id]").forEach((preview) => {
      if (preview.querySelector(`.${PAGE_BUTTON_CLASS}`)) {
        return;
      }

      const originalUrl = getListingOriginalUrl(preview);
      const previewContainer = preview.querySelector(".post-preview-container");

      if (!originalUrl || !previewContainer) {
        return;
      }

      const actions = getListingActionContainer(preview, previewContainer);

      const button = document.createElement("a");
      button.className = PAGE_BUTTON_CLASS;
      button.href = originalUrl;
      button.target = "_blank";
      button.rel = "noopener noreferrer";
      button.title = "Download original; middle-click to open original";
      button.setAttribute("aria-label", "Download original; middle-click to open original");

      button.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        downloadOriginal(originalUrl, getListingDownloadName(preview, originalUrl));
      });

      button.addEventListener("auxclick", (event) => {
        if (event.button !== 1) {
          return;
        }

        openOriginalInNewTab(originalUrl, event);
      });

      button.addEventListener("mousedown", (event) => {
        if (event.button === 1) {
          event.preventDefault();
        }

        event.stopPropagation();
      });

      button.addEventListener("mouseup", (event) => {
        if (event.button !== 1) {
          return;
        }

        openOriginalInNewTab(originalUrl, event);
      });

      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        downloadOriginal(originalUrl, getListingDownloadName(preview, originalUrl));
      });

      actions.append(button);
    });
  }

  function getPostId() {
    const metaId = document.querySelector('meta[name="post-id"]')?.content;
    const containerId = document.querySelector(".image-container[data-id]")?.dataset.id;
    const pathId = location.pathname.match(/^\/posts\/(\d+)/)?.[1];
    const id = metaId || containerId || pathId;

    return id && /^\d+$/.test(id) ? id : null;
  }

  function getPostPageDomOriginalUrl() {
    const originalLink = document.querySelector(".image-view-original-link[href]");
    const downloadLink = document.querySelector("#post-option-download a[href]");
    const shownMediaLink = document.querySelector(".image-container a[href*='/original/'], .image-container a[href*='/sample/']");
    const imageContainer = document.querySelector(".image-container[data-file-url]");

    return stripDownloadParam(
      originalLink?.href ||
      downloadLink?.href ||
      shownMediaLink?.href ||
      imageContainer?.dataset.fileUrl ||
      ""
    );
  }

  function getPostPageDownloadName(originalUrl) {
    const downloadLink = document.querySelector("#post-option-download a[download]");
    const urlName = cleanDownloadName(filenameFromUrl(originalUrl));
    const downloadName = cleanDownloadName(downloadLink?.getAttribute("download") || "");
    return urlName && !isMd5Filename(urlName)
      ? urlName
      : downloadName || urlName || "danbooru-original";
  }

  async function fetchPostPageOriginalUrlFromApi() {
    const postId = getPostId();

    if (!postId) {
      return "";
    }

    const response = await fetch(`/posts/${postId}.json`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return "";
    }

    const post = await response.json();
    rememberPost(post);
    return post?.id ? originalUrlByPostId.get(String(post.id)) || "" : "";
  }

  async function resolvePostPageOriginalUrl() {
    return getPostPageDomOriginalUrl() || fetchPostPageOriginalUrlFromApi();
  }

  function fallbackDownload(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
  }

  function downloadOriginal(originalUrl, filename) {
    const downloadUrl = addDownloadParam(originalUrl);
    const name = cleanDownloadName(filename || filenameFromUrl(originalUrl)) || "danbooru-original";

    if (typeof GM_download === "function") {
      GM_download({
        url: downloadUrl,
        name,
        saveAs: false,
        onerror: () => fallbackDownload(downloadUrl, name),
      });
      return;
    }

    if (globalThis.GM?.download) {
      globalThis.GM.download({ url: downloadUrl, name, saveAs: false })
        .catch(() => fallbackDownload(downloadUrl, name));
      return;
    }

    fallbackDownload(downloadUrl, name);
  }

  function openOriginalInNewTab(originalUrl, event) {
    const now = Date.now();

    event.preventDefault();
    event.stopPropagation();

    if (lastMiddleOpenUrl === originalUrl && now - lastMiddleOpenAt < 300) {
      return;
    }

    lastMiddleOpenUrl = originalUrl;
    lastMiddleOpenAt = now;
    window.open(originalUrl, "_blank", "noopener,noreferrer");
  }

  function getShownMedia() {
    const container = document.querySelector(".image-container");
    if (!container) {
      return null;
    }

    return container.querySelector("img#image, video#image, img.fit-width, video");
  }

  function mediaIsUsable(media) {
    if (!media || !media.isConnected) {
      return false;
    }

    const rect = media.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function positionPostPageActions(actions, media) {
    if (!mediaIsUsable(media)) {
      actions.style.display = "none";
      return;
    }

    const rect = media.getBoundingClientRect();
    const actionsParentRect = actions.parentElement?.getBoundingClientRect();
    const leftOffset = actionsParentRect ? Math.max(0, rect.left - actionsParentRect.left) : 0;

    actions.style.display = "flex";
    actions.style.width = `${Math.round(rect.width)}px`;
    actions.style.marginLeft = `${Math.round(leftOffset)}px`;
  }

  function bindPostPageActionPositioning(actions, media) {
    const update = () => positionPostPageActions(actions, media);
    const observer = new ResizeObserver(update);

    observer.observe(media);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    if (media instanceof HTMLImageElement && !media.complete) {
      media.addEventListener("load", update, { once: true });
    }

    update();
  }

  async function installPostPageDownloadOverlay() {
    if (!isPostShowPage()) {
      return;
    }

    const media = getShownMedia();

    const container = document.querySelector(".image-container");

    if (!media || !container || document.querySelector(`.${SHOW_BUTTON_CLASS}`) || postPageOverlayPending) {
      return;
    }

    postPageOverlayPending = true;
    let originalUrl = "";

    try {
      originalUrl = await resolvePostPageOriginalUrl();
    } finally {
      postPageOverlayPending = false;
    }

    if (!originalUrl) {
      return;
    }

    const overlay = document.createElement("a");
    overlay.className = SHOW_BUTTON_CLASS;
    overlay.href = originalUrl;
    overlay.target = "_blank";
    overlay.rel = "noopener noreferrer";
    overlay.title = "Download original; middle-click to open original";
    overlay.setAttribute("aria-label", "Download original; middle-click to open original");

    overlay.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      downloadOriginal(originalUrl, getPostPageDownloadName(originalUrl));
    });

    overlay.addEventListener("auxclick", (event) => {
      if (event.button !== 1) {
        return;
      }

      openOriginalInNewTab(originalUrl, event);
    });

    overlay.addEventListener("mousedown", (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }

      event.stopPropagation();
    });

    overlay.addEventListener("mouseup", (event) => {
      if (event.button !== 1) {
        return;
      }

      openOriginalInNewTab(originalUrl, event);
    });

    let actions = document.querySelector(`.${SHOW_ACTIONS_CLASS}`);
    if (!actions) {
      actions = document.createElement("div");
      actions.className = SHOW_ACTIONS_CLASS;
      container.after(actions);
    }

    actions.append(overlay);
    bindPostPageActionPositioning(actions, media);
  }

  function runIndexTools() {
    rewriteBatchPagination();
    installListingDownloadButtons();
  }

  function observePageChanges() {
    const observer = new MutationObserver(() => {
      runIndexTools();
      installPostPageDownloadOverlay();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  addStyles();
  runIndexTools();
  loadBatchPages();
  installPostPageDownloadOverlay();
  observePageChanges();
})();

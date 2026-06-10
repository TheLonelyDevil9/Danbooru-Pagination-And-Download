# Danbooru Pagination And Download

Private userscript repository for `Danbooru Pagination And Download.user.js`.

Loads batches of Danbooru post-list pages and adds one-click original download buttons to listing thumbnails and post images.

JPEG originals are automatically re-encoded to lossless PNG on download (in-browser, via canvas). Note this cannot remove JPEG artifacts already present in the source file — it only prevents any further quality loss. PNGs come out noticeably larger than the source JPEG. Set `CONVERT_JPEG_TO_PNG = false` at the top of the script to disable and download originals as-is.

## Install

https://raw.githubusercontent.com/TheLonelyDevil9/Danbooru-Pagination-And-Download/main/Danbooru%20Pagination%20And%20Download.user.js


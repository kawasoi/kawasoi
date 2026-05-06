const DB_ID = '3584bb35b51e8088b5c3dacc3c11bf40';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN is not set' });

  const notionHeaders = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const pageId = req.query.id;

  function processBlocks(blocks) {
    return blocks.map(block => {
      if (block.type === 'paragraph') {
        const rt = (block.paragraph.rich_text || []).map(t => ({
          ...t,
          plain_text: t.plain_text.replace(/\n/g, '<br>'),
        }));
        return { ...block, paragraph: { ...block.paragraph, rich_text: rt } };
      }
      if (block.type === 'image') {
        const img = block.image;
        const url = img.type === 'file' ? img.file.url : (img.external?.url || '');
        return { ...block, imageUrl: url };
      }
      return block;
    });
  }

  try {
    if (pageId) {
      const [pageRes, blocksRes] = await Promise.all([
        fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders }),
        fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers: notionHeaders }),
      ]);
      const [page, blocks] = await Promise.all([pageRes.json(), blocksRes.json()]);
      return res.status(200).json({ page, blocks: processBlocks(blocks.results ?? []) });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;

    const dbRes = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        sorts: [{ property: '発行日', direction: 'descending' }],
        ...(limit ? { page_size: limit } : {}),
      }),
    });
    const data = await dbRes.json();

    // 各ページのブロックを並列取得し、最初のparagraphをexcerptとして付与
    const results = await Promise.all(
      (data.results || []).map(async (page) => {
        const blocksRes = await fetch(
          `https://api.notion.com/v1/blocks/${page.id}/children?page_size=50`,
          { headers: notionHeaders }
        );
        const blocks = await blocksRes.json();
        const blockResults = blocks.results || [];

        const firstParagraph = blockResults.find(b => b.type === 'paragraph');
        const excerpt = firstParagraph
          ? (firstParagraph.paragraph.rich_text || []).map(t => t.plain_text).join('').replace(/\n/g, '<br>')
          : '';

        const toc = blockResults
          .filter(b => b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3')
          .map(b => (b[b.type]?.rich_text || []).map(t => t.plain_text).join(''));

        return { ...page, excerpt, toc };
      })
    );

    return res.status(200).json({ ...data, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

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

  try {
    if (pageId) {
      const [pageRes, blocksRes] = await Promise.all([
        fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders }),
        fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers: notionHeaders }),
      ]);
      const [page, blocks] = await Promise.all([pageRes.json(), blocksRes.json()]);
      return res.status(200).json({ page, blocks: blocks.results ?? [] });
    }

    const dbRes = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        sorts: [{ property: '発行日', direction: 'descending' }],
      }),
    });
    const data = await dbRes.json();

    // 各ページのブロックを並列取得し、最初のparagraphをexcerptとして付与
    const results = await Promise.all(
      (data.results || []).map(async (page) => {
        const blocksRes = await fetch(
          `https://api.notion.com/v1/blocks/${page.id}/children?page_size=10`,
          { headers: notionHeaders }
        );
        const blocks = await blocksRes.json();
        const firstParagraph = (blocks.results || []).find(b => b.type === 'paragraph');
        const excerpt = firstParagraph
          ? (firstParagraph.paragraph.rich_text || []).map(t => t.plain_text).join('').replace(/\n/g, '<br>')
          : '';
        return { ...page, excerpt };
      })
    );

    return res.status(200).json({ ...data, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

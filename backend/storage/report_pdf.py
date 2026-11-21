"""Render saved Markdown reports as paginated PDFs."""
from html import escape
from io import BytesIO

import fitz
from markdown_it import MarkdownIt
from backend.storage.report_text import format_report_text

PDF_CSS = """
body { font-family: sans-serif; font-size: 10.5pt; line-height: 1.5; color: #232e42; }
h1, h2, h3 { color: #1d3259; line-height: 1.25; }
h1 { font-size: 23pt; }
h2 { font-size: 16pt; }
h3 { font-size: 12pt; }
p { margin: 6pt 0 9pt; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 5pt; border: 1px solid #dce3ee; }
th, pre { background: #eef2f8; }
blockquote { border-left: 2pt solid #879bc1; padding-left: 10pt; margin-left: 0; }
pre { padding: 7pt; white-space: pre-wrap; }
"""


def render_report_pdf(markdown: str) -> bytes:
    parser = MarkdownIt("commonmark", {"html": False}).enable("table")
    parser.renderer.rules["image"] = lambda tokens, index, options, env: escape(tokens[index].content)
    html = parser.render(format_report_text(markdown))
    page = fitz.paper_rect("a4")
    content = page + (44, 49, -44, -50)
    buffer = BytesIO()
    writer = fitz.DocumentWriter(buffer)
    try:
        fitz.Story(html, user_css=PDF_CSS).write(writer, lambda number, filled: (page, content, None))
    finally:
        writer.close()
    with fitz.open(stream=buffer.getvalue(), filetype="pdf") as document:
        document.set_metadata({"title": "PaperResearch-Agent Research Report", "creator": "PaperResearch-Agent"})
        for number, pdf_page in enumerate(document, start=1):
            pdf_page.insert_text((44, 27), "PaperResearch-Agent  /  Research report", fontsize=9, color=(0.32, 0.39, 0.5))
            pdf_page.insert_text((44, page.height - 25), f"{number} / {len(document)}", fontsize=9, color=(0.32, 0.39, 0.5))
        return document.tobytes(garbage=3, deflate=True)

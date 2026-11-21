"""Convert internal gap labels into prose without rewriting saved research data."""
import re

GAP_LEADS = {
    "method_gap": "在研究方法方面，",
    "repeated_limitation": "在共同局限方面，",
    "contradictory": "在研究结论的一致性方面，",
    "unfulfilled_future": "在后续研究的落实方面，",
}
_LABEL = re.compile(
    r"^([ \t]*(?:(?:\d+[.)]|[-+*])[ \t]+)?)"
    r"\[(method_gap|repeated_limitation|contradictory|unfulfilled_future)\](?![\[(])[ \t]*"
)


def format_report_text(markdown: str) -> str:
    fence = None
    lines = []
    for line in markdown.split("\n"):
        boundary = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if boundary:
            marker, tail = boundary.groups()
            if fence is None:
                fence = (marker[0], len(marker))
            elif marker[0] == fence[0] and len(marker) >= fence[1] and not tail.strip():
                fence = None
        elif fence is None and not re.match(r"^(?: {4}|\t)", line):
            line = _LABEL.sub(lambda match: match[1] + GAP_LEADS[match[2]], line, count=1)
        lines.append(line)
    return "\n".join(lines)

#!/usr/bin/env python3
"""Expected results of the desktop's title substitutions, for titles/svg.test.ts.

Dev-time only. Reads a few zenvi-core title templates at origin/main and
applies, with xml.dom.minidom exactly like the desktop:
  - agent_tools/titles.py `_set_svg_text`
  - title_editor.py `txtLine_changed`, `set_font_attributes`,
    `set_font_color_elements`, `set_bg_style` (style_tools helpers)
Writes src/titles/__fixtures__/desktop-titles.json with the template text and
the resulting text content / styles of every <text>, <tspan> and the first <rect>.

    python3 packages/engine/scripts/gen-title-fixture.py
"""

import json
import os
import subprocess
from xml.dom import minidom

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "titles", "__fixtures__", "desktop-titles.json")
REPO = os.environ.get("ZENVI_DESKTOP_REPO", os.path.expanduser("~/Projects/zenvi"))
TEMPLATES = ["Bar_1.svg", "Standard_1.svg", "Footer_1.svg", "Gold_1.svg", "Oval_1.svg", "Solid_Color.svg", "Header_2.svg"]


def git_show(path):
    return subprocess.check_output(["git", "-C", REPO, "show", f"origin/main:{path}"]).decode("utf-8")


def style_to_dict(style):
    d = {}
    d.update(a.split(":", 1) for a in style.split(";") if a)
    return d


def dict_to_style(d):
    return ";".join(":".join([k, v]) for k, v in d.items()) + ";"


def set_svg_text(xmldoc, text):
    text_nodes = list(xmldoc.getElementsByTagName("text"))
    tspan_nodes = list(xmldoc.getElementsByTagName("tspan"))
    targets = tspan_nodes or text_nodes
    if not targets:
        return
    node = targets[0]
    while node.firstChild:
        node.removeChild(node.firstChild)
    node.appendChild(xmldoc.createTextNode(text))
    for extra in targets[1:]:
        while extra.firstChild:
            extra.removeChild(extra.firstChild)
        extra.appendChild(xmldoc.createTextNode(""))


def editor_edits(xmldoc, lines, family, bold, italic, ratio, color, alpha, bg, bg_alpha):
    tspan_nodes = xmldoc.getElementsByTagName("tspan")
    text_nodes = xmldoc.getElementsByTagName("text")
    rect_node = xmldoc.getElementsByTagName("rect")
    # set_font_attributes
    for child in list(text_nodes) + list(tspan_nodes):
        ard = style_to_dict(child.getAttribute("style"))
        ard["font-family"] = f"'{family}'"
        ard["font-style"] = "italic" if italic else "normal"
        ard["font-weight"] = "bold" if bold else "normal"
        if ratio != 1.0 and "font-size" in ard:
            ard["font-size"] = f"{ratio * float(ard['font-size'][:-2])}px"
        child.setAttribute("style", dict_to_style(ard))
    # set_font_color_elements
    for child in list(text_nodes) + list(tspan_nodes):
        ard = style_to_dict(child.getAttribute("style"))
        ard.update({"fill": color, "opacity": str(alpha)})
        child.setAttribute("style", dict_to_style(ard))
    # set_bg_style
    if rect_node:
        ard = style_to_dict(rect_node[0].getAttribute("style"))
        ard.update({"fill": bg, "opacity": str(bg_alpha)})
        rect_node[0].setAttribute("style", dict_to_style(ard))
    # txtLine_changed
    for i, node in enumerate(tspan_nodes):
        if len(node.childNodes) > 0 and i <= (len(lines) - 1):
            new_text_node = xmldoc.createTextNode(lines[i])
            old = node.childNodes[0]
            node.removeChild(old)
            node.appendChild(new_text_node)


def text_of(node):
    return "".join(c.data if c.nodeType == c.TEXT_NODE else text_of(c) for c in node.childNodes)


def summary(xmldoc):
    out = []
    for tag in ("text", "tspan"):
        for node in xmldoc.getElementsByTagName(tag):
            out.append({"tag": tag, "text": text_of(node), "style": style_to_dict(node.getAttribute("style"))})
    rects = xmldoc.getElementsByTagName("rect")
    rect = style_to_dict(rects[0].getAttribute("style")) if rects else None
    return {"nodes": out, "rect": rect}


EDITOR = {
    "lines": ["First & <line>", "Second"],
    "family": "Sans Serif",
    "bold": True,
    "italic": False,
    "ratio": 1.5,
    "color": "#ff0000",
    "alpha": 0.5,
    "bg": "#00ff00",
    "bg_alpha": 1.0,
}


def main():
    cases = []
    for name in TEMPLATES:
        svg = git_show(f"src/titles/{name}")
        agent = minidom.parseString(svg.encode("utf-8"))
        set_svg_text(agent, "Hello & <World>")
        editor = minidom.parseString(svg.encode("utf-8"))
        editor_edits(editor, **EDITOR)
        original = minidom.parseString(svg.encode("utf-8"))
        cases.append({
            "name": name,
            "svg": svg,
            "original": summary(original),
            "agent": summary(agent),
            "editor": summary(editor),
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"generator": "packages/engine/scripts/gen-title-fixture.py", "editor": EDITOR, "cases": cases}, f)
        f.write("\n")
    print(f"wrote {OUT} ({len(cases)} templates)")


if __name__ == "__main__":
    main()

---
"@tickdeck/elements": patch
"@tickdeck/chart": patch
---

Elements fill the space their layout gives them: the host is a flex column (`display: flex`) whose visible box grows to the host's height, so a ticket stretched next to a chart ends at the chart's bottom; without an imposed height an element keeps its natural height, and a short account panel scrolls its table. A chart whose container is sized by a grid or flex row now shrinks again when the row does (its canvases no longer hold the container at its previous height). The READMEs and examples show one equal-height pattern for a chart and a column of widgets.

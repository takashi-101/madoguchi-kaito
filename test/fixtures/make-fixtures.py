# テスト用の文書（架空）を作る： python3 test/fixtures/make-fixtures.py
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
here = os.path.dirname(os.path.abspath(__file__))
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiMin-W3'))
c = canvas.Canvas(os.path.join(here, 'test-manual.pdf'), pagesize=A4)
pages = [
  ['テスト用事務手引（架空）', '', '第1章 総則', '', 'この手引は、テスト用の架空の事務を定める。'],
  ['第2章 証明書の交付', '', '1．手数料', '', 'ジュウミンヒョウの写しの交付手数料は、1通につき300円とする。', '申し込みは窓口で受け付ける。'],
]
for lines in pages:
  y = 800
  for ln in lines:
    if ln:
      c.setFont('HeiseiMin-W3', 11)
      c.drawString(60, y, ln)
    y -= 22
  c.showPage()
c.save()
txt = '第1章　総則\n\n（目的）\n第１条　この要綱は、テスト用の架空の事業について定める。\n\n第2章　申請\n\n（申込）\n第２条　申込みは、所定の申込書により行うものとする。\n２　前項の申込書は、窓口に備える。\n'
open(os.path.join(here, 'test-yoko-sjis.txt'), 'wb').write(txt.encode('shift_jis'))
html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>テスト案内</title></head><body><h1>テスト案内（架空）</h1><h2>粗大ごみ</h2><p>粗大ごみの収集は<b>予約制</b>です。</p><ul><li>受付は電話で行います。</li></ul><table><tr><th>品目</th><td>500円</td></tr></table></body></html>'
open(os.path.join(here, 'test-guide.html'), 'w', encoding='utf-8').write(html)

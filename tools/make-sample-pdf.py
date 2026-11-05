# 見本の要綱をPDF（文字を選べるPDF）にする。reportlab を使う。
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'yoko-for-pdf.txt'), encoding='utf-8').read()
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiMin-W3'))
c = canvas.Canvas(os.path.join(here, '..', 'sample', '見本町粗大ごみ収集受付要綱.pdf'), pagesize=A4)
c.setTitle('見本町粗大ごみ収集受付要綱（架空の見本）')
W = 40  # 1行の字数
for page in src.split('\f'):
    y = 790
    for line in page.split('\n'):
        chunks = [line[i:i + W] for i in range(0, len(line), W)] or ['']
        for k, ch in enumerate(chunks):
            if ch:
                c.setFont('HeiseiMin-W3', 11)
                c.drawString(60 if k == 0 else 71, y, ch)
            y -= 18
    c.showPage()
c.save()
os.remove(os.path.join(here, 'yoko-for-pdf.txt'))
print('PDF を作りました')

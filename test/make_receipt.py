from PIL import Image, ImageDraw, ImageFont
import sys
W,H=600,900
im=Image.new('RGB',(W,H),(250,250,247)); d=ImageDraw.Draw(im)
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',26)
except: f=ImageFont.load_default()
lines=['   BAGELS & BEANS','  Neude 30 Utrecht','','08-10-26   12:41','','Bagel zalm     9,25','Bagel kip      8,75','Cappuccino     3,40','Thee           2,10','------------------','TOTAAL        23,50','PIN           23,50','BTW 9%         1,94','','  Bedankt!']
y=40
for l in lines: d.text((40,y),l,fill=(30,30,30),font=f); y+=48
im=im.rotate(2,expand=True,fillcolor=(60,60,60))
im.save(sys.argv[1],quality=90)

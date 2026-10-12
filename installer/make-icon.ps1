# Draws the Payroll Workspace icon and writes a PNG-based .ico (256 x 256).
param([string]$Out)
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.Clear([System.Drawing.Color]::Transparent)
function RoundRect($x, $y, $w, $h, $r) { $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $p.AddArc($x, $y, $r, $r, 180, 90); $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90); $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90); $p.CloseFigure(); $p }
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 38, 58))), (RoundRect 8 8 240 240 56))
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 153, 155))), (RoundRect 58 50 140 170 22))
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 141, 230, 223))), (RoundRect 96 34 64 36 14))
$font = New-Object System.Drawing.Font('Segoe UI', 86, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString([string][char]0x20B9, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 58, 62, 140, 160), $fmt)
$g.Dispose()
# Classic 32-bit DIB entries (16/32/48) for every consumer, plus a PNG entry for 256.
function Dib($s) {
  $small = New-Object System.Drawing.Bitmap $s, $s; $sg = [System.Drawing.Graphics]::FromImage($small); $sg.InterpolationMode = 'HighQualityBicubic'; $sg.DrawImage($bmp, 0, 0, $s, $s); $sg.Dispose()
  $ms = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint32]40); $bw.Write([int32]$s); $bw.Write([int32]($s * 2)); $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0); $bw.Write([uint32]0); $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
  for ($y = $s - 1; $y -ge 0; $y--) { for ($x = 0; $x -lt $s; $x++) { $c = $small.GetPixel($x, $y); $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A) } }
  $maskRow = [int]([math]::Ceiling($s / 32) * 4); $bw.Write((New-Object byte[] ($maskRow * $s)))
  $bw.Flush(); $small.Dispose(); return ,$ms.ToArray()
}
$pngStream = New-Object System.IO.MemoryStream; $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$entries = @(@{ s = 16; d = (Dib 16) }, @{ s = 32; d = (Dib 32) }, @{ s = 48; d = (Dib 48) }, @{ s = 256; d = $pngStream.ToArray() })
$w = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($Out))
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) { $dim = if ($e.s -ge 256) { 0 } else { $e.s }; $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$e.d.Length); $w.Write([uint32]$offset); $offset += $e.d.Length }
foreach ($e in $entries) { $w.Write($e.d) }
$w.Close()
Write-Host "icon written: $Out"

# Draws the Biometric Attendance icon (white fingerprint on blue) and writes a .ico with 16/32/48 DIB and 256 PNG entries.
param([string]$Out = (Join-Path $PSScriptRoot 'app.ico'))
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
function RoundRect($x, $y, $w, $h, $r) { $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $p.AddArc($x, $y, $r, $r, 180, 90); $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90); $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90); $p.CloseFigure(); $p }
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 29, 95, 191))), (RoundRect 8 8 240 240 56))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 12
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'
$cx = 128; $cy = 132
# Tall nested ridges that almost close at the bottom, each ending at a different place, like a fingerprint.
foreach ($ring in @(@(84, 150, 250), @(64, 130, 285), @(44, 115, 305), @(24, 100, 320))) {
  $rx = $ring[0]; $ry = $rx * 1.2
  $g.DrawArc($pen, [single]($cx - $rx), [single]($cy - $ry), [single](2 * $rx), [single](2 * $ry), $ring[1], $ring[2])
}
$g.DrawLine($pen, $cx, $cy - 6, $cx, $cy + 30)
$g.Dispose()
function Dib($s) {
  $small = New-Object System.Drawing.Bitmap $s, $s; $sg = [System.Drawing.Graphics]::FromImage($small); $sg.InterpolationMode = 'HighQualityBicubic'; $sg.DrawImage($bmp, 0, 0, $s, $s); $sg.Dispose()
  $ms = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint32]40); $bw.Write([int32]$s); $bw.Write([int32]($s * 2)); $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0); $bw.Write([uint32]0); $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
  for ($y = $s - 1; $y -ge 0; $y--) { for ($x = 0; $x -lt $s; $x++) { $c = $small.GetPixel($x, $y); $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A) } }
  $maskRow = [int]([math]::Ceiling($s / 32) * 4); $bw.Write((New-Object byte[] ($maskRow * $s)))
  $bw.Flush(); $small.Dispose(); return ,$ms.ToArray()
}
$pngStream = New-Object System.IO.MemoryStream; $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save([IO.Path]::ChangeExtension($Out, '.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$entries = @(@{ s = 16; d = (Dib 16) }, @{ s = 32; d = (Dib 32) }, @{ s = 48; d = (Dib 48) }, @{ s = 256; d = $pngStream.ToArray() })
$w = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($Out))
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) { $dim = if ($e.s -ge 256) { 0 } else { $e.s }; $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$e.d.Length); $w.Write([uint32]$offset); $offset += $e.d.Length }
foreach ($e in $entries) { $w.Write($e.d) }
$w.Close()
Write-Host "icon written: $Out"

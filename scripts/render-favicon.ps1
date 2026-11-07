Add-Type -AssemblyName System.Drawing

$width = 128
$height = 128
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# 100% Transparent background (no white background!)
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded Rectangle Path
function Get-RoundedRectPath($x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

$pad = 6
$rectW = $width - ($pad * 2)
$rectH = $height - ($pad * 2)
$radius = 32

$roundPath = Get-RoundedRectPath $pad $pad $rectW $rectH $radius

# Fill Obsidian Card
$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 9, 11, 16))
$g.FillPath($bgBrush, $roundPath)

# Emerald to Teal Gradient Border
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.PointF $pad, ($pad + $rectH)),
    (New-Object System.Drawing.PointF ($pad + $rectW), $pad),
    [System.Drawing.Color]::FromArgb(255, 16, 185, 129),
    [System.Drawing.Color]::FromArgb(255, 45, 212, 191)
)
$borderPen = New-Object System.Drawing.Pen $gradBrush, 6.0
$borderPen.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Center
$g.DrawPath($borderPen, $roundPath)

# Project Dollar Icon: M12 2v20 M17 5 H9.5 a3.5 3.5 0 0 0 0 7 h5 a3.5 3.5 0 0 1 0 7 H6
# In 128x128 space, scaling factor = 4.4, offset = (128 - 24*4.4)/2 = (128 - 105.6)/2 = 11.2
$scale = 4.6
$ox = ($width - (24 * $scale)) / 2.0
$oy = ($height - (24 * $scale)) / 2.0

function S($val) { return $val * $script:scale }
function PX($x) { return $script:ox + (S $x) }
function PY($y) { return $script:oy + (S $y) }

$symbolPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 52, 211, 153)), (2.3 * $scale)
$symbolPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$symbolPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$symbolPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# 1. Vertical center line: M12 2 v20
$g.DrawLine($symbolPen, (PX 12), (PY 2.5), (PX 12), (PY 21.5))

# 2. Dollar 'S' Path
$dollarPath = New-Object System.Drawing.Drawing2D.GraphicsPath
# Start at (17, 5.5) -> Line to (9.5, 5.5)
$dollarPath.AddLine((PX 17), (PY 5.5), (PX 9.5), (PY 5.5))
# Arc from (9.5, 5.5) around left down to (9.5, 12.5): center (9.5, 9.0), radius 3.5
$rVal = S 3.5
$dVal = $rVal * 2
$dollarPath.AddArc((PX 9.5) - $rVal, (PY 9.0) - $rVal, $dVal, $dVal, 270, -180)
# Horizontal connecting segment from (9.5, 12.5) to (14.5, 12.5)
$dollarPath.AddLine((PX 9.5), (PY 12.5), (PX 14.5), (PY 12.5))
# Arc from (14.5, 12.5) around right down to (14.5, 19.5): center (14.5, 16.0), radius 3.5
$dollarPath.AddArc((PX 14.5) - $rVal, (PY 16.0) - $rVal, $dVal, $dVal, 270, 180)
# Line to (6, 19.5)
$dollarPath.AddLine((PX 14.5), (PY 19.5), (PX 6), (PY 19.5))

$g.DrawPath($symbolPen, $dollarPath)

$destPng = Join-Path $PSScriptRoot "..\favicon.png"
$destIco = Join-Path $PSScriptRoot "..\favicon.ico"

$bmp.Save($destPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($destIco, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()

Write-Output "Successfully generated smooth transparent favicon.png and favicon.ico"

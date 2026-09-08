param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath,

    [Parameter(Position = 1)]
    [string]$Languages = "it-IT,en-US"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Await-WinRtOperation {
    param(
        [Parameter(Mandatory = $true)] $Operation,
        [Parameter(Mandatory = $true)] [Type]$ResultType
    )

    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq "AsTask" -and
            $_.IsGenericMethod -and
            $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
        } |
        Select-Object -First 1

    if ($null -eq $asTask) {
        throw "Supporto WinRT asincrono non disponibile"
    }
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

    $resolvedImagePath = [System.IO.Path]::GetFullPath($ImagePath)
    if (-not [System.IO.File]::Exists($resolvedImagePath)) {
        throw "Immagine OCR non trovata"
    }

    $file = Await-WinRtOperation `
        ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedImagePath)) `
        ([Windows.Storage.StorageFile])
    $stream = Await-WinRtOperation `
        ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) `
        ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRtOperation `
        ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) `
        ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRtOperation `
        ($decoder.GetSoftwareBitmapAsync()) `
        ([Windows.Graphics.Imaging.SoftwareBitmap])

    $requestedLanguages = @($Languages.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $availableLanguages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
    $selectedLanguage = $null
    foreach ($requestedLanguage in $requestedLanguages) {
        $selectedLanguage = $availableLanguages |
            Where-Object { $_.LanguageTag -ieq $requestedLanguage } |
            Select-Object -First 1
        if ($null -ne $selectedLanguage) { break }
    }
    if ($null -eq $selectedLanguage) {
        foreach ($requestedLanguage in $requestedLanguages) {
            $languagePrefix = $requestedLanguage.Split("-")[0]
            $selectedLanguage = $availableLanguages |
                Where-Object { $_.LanguageTag.Split("-")[0] -ieq $languagePrefix } |
                Select-Object -First 1
            if ($null -ne $selectedLanguage) { break }
        }
    }

    $engine = if ($null -ne $selectedLanguage) {
        [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($selectedLanguage)
    } else {
        [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if ($null -eq $engine) {
        throw "Nessuna lingua OCR di Windows installata. Aggiungi italiano o inglese nelle impostazioni Lingua."
    }

    $result = Await-WinRtOperation `
        ($engine.RecognizeAsync($bitmap)) `
        ([Windows.Media.Ocr.OcrResult])
    $pixelWidth = [double]$bitmap.PixelWidth
    $pixelHeight = [double]$bitmap.PixelHeight
    if ($pixelWidth -le 0 -or $pixelHeight -le 0) {
        throw "Dimensioni immagine OCR non valide"
    }

    $observations = @()
    foreach ($line in $result.Lines) {
        $words = @($line.Words)
        if ($words.Count -eq 0 -or [string]::IsNullOrWhiteSpace($line.Text)) { continue }
        $left = ($words | ForEach-Object { [double]$_.BoundingRect.X } | Measure-Object -Minimum).Minimum
        $top = ($words | ForEach-Object { [double]$_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
        $right = ($words | ForEach-Object { [double]$_.BoundingRect.X + [double]$_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
        $bottom = ($words | ForEach-Object { [double]$_.BoundingRect.Y + [double]$_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
        $observations += [PSCustomObject]@{
            text = [string]$line.Text
            confidence = 1.0
            # Match Apple Vision: normalized origin is bottom-left.
            bbox = @(
                $left / $pixelWidth,
                1.0 - ($bottom / $pixelHeight),
                ($right - $left) / $pixelWidth,
                ($bottom - $top) / $pixelHeight
            )
        }
    }

    ConvertTo-Json -InputObject @($observations) -Compress -Depth 4
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

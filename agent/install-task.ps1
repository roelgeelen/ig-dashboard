# Registreert de dagelijkse taak in Windows Taakplanner.
# Draaien met:  powershell -ExecutionPolicy Bypass -File .\install-task.ps1
# Verwijderen:  powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Remove

param(
    [switch]$Remove,
    [string]$Time = "08:00"
)

$TaskName = "IG Dashboard Agent"
$AgentDir = $PSScriptRoot

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Taak '$TaskName' verwijderd."
    } else {
        Write-Host "Taak '$TaskName' bestond niet."
    }
    exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error "node niet gevonden in PATH. Installeer Node.js en probeer opnieuw."
    exit 1
}

if (-not (Test-Path (Join-Path $AgentDir ".env"))) {
    Write-Warning "agent\.env bestaat nog niet. Kopieer .env.example naar .env en vul hem in, anders faalt elke run."
}

$action = New-ScheduledTaskAction -Execute $node -Argument "run.js" -WorkingDirectory $AgentDir

# StartWhenAvailable zorgt dat een gemiste run (PC uit om 08:00) alsnog draait
# zodra de PC weer aan is. Dat is precies waarom een dagelijkse taak volstaat
# terwijl er maar eens per vier dagen echt iets te doen is.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Vraagt elke 4 dagen automatisch de Instagram data-export aan en werkt het dashboard bij." | Out-Null

Write-Host "Taak '$TaskName' aangemaakt: elke dag om $Time, gemiste runs worden ingehaald."
Write-Host "Handmatig testen:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Log bekijken:      Get-Content '$AgentDir\agent.log' -Tail 30"

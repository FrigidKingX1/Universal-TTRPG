' Auto-DM Silent Launcher
' Runs the launch-autodm.bat without showing a console window

Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\launch-autodm.bat"

' Run the batch file hidden (0 = hide window)
WshShell.Run """" & batPath & """", 0, False
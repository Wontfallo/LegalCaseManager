Set objShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strPython = strPath & "\backend\.venv\Scripts\pythonw.exe"
strScript = strPath & "\launcher.py"
objShell.CurrentDirectory = strPath
objShell.Run """" & strPython & """ """ & strScript & """", 0, False

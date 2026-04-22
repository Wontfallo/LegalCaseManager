"""Poll the Copilot device flow until authorized, then re-summarize all docs."""
import httpx
import time
import sys

BASE = "http://localhost:8090"

# Login
r = httpx.post(f"{BASE}/api/auth/auto-login")
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

print("Waiting for GitHub device authorization...")
print("Go to: https://github.com/login/device")
print("Enter code: 59C8-4A43")
print()

# Poll every 5 seconds for up to 10 minutes
for i in range(120):
    r = httpx.post(f"{BASE}/api/providers/github-copilot/poll", headers=headers, timeout=30)
    data = r.json()
    status = data.get("status", "")
    print(f"  [{i*5}s] {status}: {data.get('message', '')}")
    
    if status == "complete":
        print("\n✅ GitHub Copilot reconnected!")
        
        # Now trigger re-summarize
        print("\nTriggering re-summarize for all documents...")
        r2 = httpx.post(
            f"{BASE}/api/cases/cfe020f5d08941789d26aa2f5019efbc/documents/resummarize-all",
            headers=headers,
            timeout=30,
        )
        print(f"Response: {r2.status_code} - {r2.text}")
        sys.exit(0)
    elif status == "error":
        print(f"\n❌ Error: {data.get('message')}")
        sys.exit(1)
    
    time.sleep(5)

print("\n⏰ Timed out waiting for authorization.")

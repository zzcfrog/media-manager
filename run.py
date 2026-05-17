import os
from backend import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 6622))
    url = f"http://127.0.0.1:{port}"
    print(f"Media Manager running at {url}")
    if not os.environ.get("ELECTRON"):
        import webbrowser
        webbrowser.open(url)
    app.run(host="127.0.0.1", port=port, debug=bool(os.environ.get("FLASK_DEBUG")))

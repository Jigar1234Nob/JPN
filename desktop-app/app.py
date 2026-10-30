import os
import sys
from pathlib import Path

from PySide6.QtCore import Qt, QUrl, QTimer, QElapsedTimer
from PySide6.QtGui import QSize
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QFrame, QLabel, QPushButton,
    QVBoxLayout, QHBoxLayout, QStatusBar
)
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView

DASHBOARD = "https://jigar1234nob.github.io/JPN/dashboard/"
HEALTH = "https://jpn-7x7n.onrender.com/api/health"


class JPNPage(QWebEnginePage):
    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        if url.scheme() in ("mailto", "tel"):
            from PySide6.QtGui import QDesktopServices
            QDesktopServices.openUrl(url)
            return False
        return url.scheme() in ("https", "http")


class JPNWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("JPN | Private Networking")
        self.resize(1440, 920)
        self.setMinimumSize(QSize(1080, 700))

        root = QWidget()
        self.setCentralWidget(root)
        outer = QHBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(250)
        side = QVBoxLayout(sidebar)
        side.setContentsMargins(18, 25, 18, 20)
        side.setSpacing(8)

        brand = QLabel("JPN")
        brand.setObjectName("brand")
        tagline = QLabel("J-PRIVATE-NETWORKING")
        tagline.setObjectName("tagline")
        side.addWidget(brand)
        side.addWidget(tagline)
        side.addSpacing(28)

        section = QLabel("WORKSPACE")
        section.setObjectName("section")
        side.addWidget(section)

        self.web = QWebEngineView()
        profile = QWebEngineProfile("JPNDesktop", self)
        data = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "JPN"
        data.mkdir(parents=True, exist_ok=True)
        profile.setPersistentStoragePath(str(data / "WebData"))
        profile.setCachePath(str(data / "Cache"))
        profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)
        self.web.setPage(JPNPage(profile, self.web))
        self.web.settings().setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        self.web.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        self.page_title = QLabel("Overview")
        self.page_title.setObjectName("pageTitle")
        routes = [
            ("⌂   Overview", "", "Overview"),
            ("◎   Profile", "#profile", "Profile"),
            ("◇   Security", "#security", "Security"),
            ("⇩   Downloads", "#downloads", "Downloads"),
            ("✧   Plans", "#plans", "Plans"),
            ("✉   Support", "#support", "Support"),
            ("✓   What Works?", "#compatibility", "What Works?"),
        ]
        for label, route, title in routes:
            b = QPushButton(label)
            b.setObjectName("nav")
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(lambda checked=False, r=route, t=title: self.open_section(r, t))
            side.addWidget(b)

        side.addStretch(1)
        vpn = QFrame()
        vpn.setObjectName("vpn")
        vbox = QVBoxLayout(vpn)
        vbox.setContentsMargins(14, 14, 14, 14)
        vbox.setSpacing(8)
        vtitle = QLabel("JPN CONNECTION")
        vtitle.setObjectName("vtitle")
        self.vstate = QLabel("VPN engine not installed")
        self.vstate.setObjectName("vstate")
        self.start = QPushButton("START VPN")
        self.start.setObjectName("start")
        self.start.setEnabled(False)
        self.start.setToolTip("A real Windows TUN/VPN engine must be integrated before this control can safely connect.")
        vnote = QLabel("Tunnel controls will activate after the Windows VPN engine is integrated.")
        vnote.setObjectName("vnote")
        vnote.setWordWrap(True)
        vbox.addWidget(vtitle)
        vbox.addWidget(self.vstate)
        vbox.addWidget(self.start)
        vbox.addWidget(vnote)
        side.addWidget(vpn)
        outer.addWidget(sidebar)

        main = QWidget()
        mainbox = QVBoxLayout(main)
        mainbox.setContentsMargins(0, 0, 0, 0)
        mainbox.setSpacing(0)
        topbar = QFrame()
        topbar.setObjectName("topbar")
        top = QHBoxLayout(topbar)
        top.setContentsMargins(25, 15, 25, 15)
        top.addWidget(self.page_title)
        top.addStretch(1)
        self.ping = QLabel("API latency: checking…")
        self.ping.setObjectName("ping")
        top.addWidget(self.ping)
        refresh = QPushButton("↻  Refresh")
        refresh.setObjectName("refresh")
        refresh.clicked.connect(self.web.reload)
        top.addWidget(refresh)
        mainbox.addWidget(topbar)
        mainbox.addWidget(self.web, 1)
        outer.addWidget(main, 1)

        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.status.showMessage("JPN Desktop • Connecting")
        self.web.loadFinished.connect(self.loaded)
        self.web.setUrl(QUrl(DASHBOARD))

        self.net = QNetworkAccessManager(self)
        self.timer = QTimer(self)
        self.timer.setInterval(4000)
        self.timer.timeout.connect(self.measure_latency)
        self.timer.start()
        QTimer.singleShot(500, self.measure_latency)

        self.setStyleSheet("""
            QWidget { background:#0b0e16; color:#f2f5fb; font-family:'Segoe UI'; font-size:13px; }
            #sidebar { background:#101521; border-right:1px solid #263044; }
            #brand { color:#53d9f0; font-size:31px; font-weight:800; letter-spacing:3px; }
            #tagline { color:#8794aa; font-size:9px; letter-spacing:1.2px; }
            #section { color:#74829a; font-size:10px; font-weight:700; letter-spacing:1.5px; padding:5px 8px; }
            QPushButton#nav { text-align:left; padding:12px; color:#b8c3d7; background:transparent; border:1px solid transparent; border-radius:9px; font-weight:600; }
            QPushButton#nav:hover { background:#ffffff0b; color:#fff; border-color:#ffffff10; }
            #vpn { background:#141c2b; border:1px solid #27364d; border-radius:13px; }
            #vtitle { color:#53d9f0; font-size:10px; font-weight:800; letter-spacing:1.3px; }
            #vstate { color:#ffd88b; font-weight:700; }
            #vnote { color:#8794aa; font-size:11px; }
            QPushButton#start { padding:12px; background:#202b3c; color:#8290a5; border:1px solid #34465e; border-radius:8px; font-weight:800; letter-spacing:1px; }
            QPushButton#start:disabled { background:#202b3c; color:#8290a5; }
            #topbar { background:#0e1420; border-bottom:1px solid #263044; }
            #pageTitle { font-size:19px; font-weight:700; }
            #ping { color:#7be0b0; font-weight:600; padding:0 12px; }
            QPushButton#refresh { background:#172337; border:1px solid #2b405e; color:#dceaff; border-radius:8px; padding:9px 13px; }
            QPushButton#refresh:hover { border-color:#53d9f0; }
            QStatusBar { background:#0e1420; color:#8291aa; border-top:1px solid #1c2940; }
        """)

    def open_section(self, route, title):
        self.page_title.setText(title)
        self.web.setUrl(QUrl(DASHBOARD + route))

    def measure_latency(self):
        req = QNetworkRequest(QUrl(HEALTH))
        req.setTransferTimeout(3500)
        elapsed = QElapsedTimer()
        elapsed.start()
        reply = self.net.get(req)
        reply.finished.connect(lambda r=reply, t=elapsed: self.latency_result(r, t))

    def latency_result(self, reply, elapsed):
        if reply.error():
            self.ping.setText("API latency: offline")
            self.ping.setStyleSheet("color:#ff9a9a;")
            self.status.showMessage("JPN API did not respond. Dashboard access may still work.")
        else:
            ms = elapsed.elapsed()
            self.ping.setText(f"API latency: {ms} ms")
            self.ping.setStyleSheet("color:#7be0b0;")
            self.status.showMessage(f"JPN API online • {ms} ms")
        reply.deleteLater()

    def loaded(self, ok):
        self.status.showMessage("Dashboard loaded • Sign in if requested" if ok else "Could not load JPN. Check your connection.")


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("JPN Desktop")
    app.setOrganizationName("Jigar Private Networking Group")
    window = JPNWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

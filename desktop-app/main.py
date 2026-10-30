import os
import sys
from pathlib import Path

from PySide6.QtCore import QUrl, QSize
from PySide6.QtGui import QAction, QDesktopServices, QIcon
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QToolBar, QLabel, QMessageBox
)
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView


APP_NAME = "JPN"
APP_URL = "https://jigar1234nob.github.io/JPN/"
APP_HOST = "jigar1234nob.github.io"


class JPNPage(QWebEnginePage):
    """Keep JPN and its authentication flow inside the desktop window."""

    def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
        if url.scheme() in ("https", "http"):
            # Keep web authentication and the JPN site in the same window.
            # Non-web links such as mailto are handed to Windows.
            return True
        if url.scheme() in ("mailto", "tel"):
            QDesktopServices.openUrl(url)
        return False


class JPNWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("JPN Desktop")
        self.resize(1360, 860)
        self.setMinimumSize(QSize(900, 600))

        data_root = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "JPN"
        data_root.mkdir(parents=True, exist_ok=True)

        self.profile = QWebEngineProfile("JPNDesktop", self)
        self.profile.setPersistentStoragePath(str(data_root / "WebData"))
        self.profile.setCachePath(str(data_root / "Cache"))
        self.profile.setPersistentCookiesPolicy(
            QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
        )

        self.view = QWebEngineView(self)
        self.page = JPNPage(self.profile, self.view)
        self.view.setPage(self.page)
        self.view.settings().setAttribute(
            QWebEngineSettings.WebAttribute.JavascriptEnabled, True
        )
        self.view.settings().setAttribute(
            QWebEngineSettings.WebAttribute.LocalStorageEnabled, True
        )
        self.view.settings().setAttribute(
            QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True
        )
        self.setCentralWidget(self.view)

        toolbar = QToolBar("JPN navigation")
        toolbar.setMovable(False)
        toolbar.setIconSize(QSize(18, 18))
        self.addToolBar(toolbar)

        brand = QLabel("  JPN  ")
        brand.setObjectName("brand")
        toolbar.addWidget(brand)

        back = QAction("‹", self)
        back.setToolTip("Back")
        back.triggered.connect(self.view.back)
        toolbar.addAction(back)

        forward = QAction("›", self)
        forward.setToolTip("Forward")
        forward.triggered.connect(self.view.forward)
        toolbar.addAction(forward)

        reload_action = QAction("⟳", self)
        reload_action.setToolTip("Reload JPN")
        reload_action.triggered.connect(self.view.reload)
        toolbar.addAction(reload_action)

        home = QAction("Home", self)
        home.triggered.connect(lambda: self.view.setUrl(QUrl(APP_URL)))
        toolbar.addAction(home)

        self.statusBar().showMessage("JPN Desktop • Connecting to JPN")
        self.view.loadStarted.connect(
            lambda: self.statusBar().showMessage("Loading JPN…")
        )
        self.view.loadFinished.connect(self.on_load_finished)
        self.view.setUrl(QUrl(APP_URL))

        self.setStyleSheet("""
            QMainWindow { background: #080d19; }
            QToolBar {
                background: #0b1221;
                border: 0;
                border-bottom: 1px solid #1c2940;
                spacing: 8px;
                padding: 9px 12px;
            }
            QToolButton {
                color: #dceaff;
                background: #142239;
                border: 1px solid #263b5b;
                border-radius: 7px;
                padding: 7px 12px;
                font-size: 14px;
            }
            QToolButton:hover {
                color: #48d7fa;
                background: #12283b;
            }
            QLabel#brand {
                color: #35c9ee;
                font-size: 19px;
                font-weight: 800;
                letter-spacing: 2px;
                padding: 0 8px;
            }
            QStatusBar {
                background: #0b1221;
                color: #8291aa;
                border-top: 1px solid #1c2940;
            }
        """)

    def on_load_finished(self, ok):
        if ok:
            self.statusBar().showMessage("JPN Desktop • Connected to JPN website")
        else:
            self.statusBar().showMessage("Unable to load JPN. Check your internet connection.")


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("JPN Desktop")
    app.setOrganizationName("Jigar Private Networking Group")
    window = JPNWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

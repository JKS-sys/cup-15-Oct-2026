// Cup — native glue around the system WebView.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved. Personal use only;
// copying, modifying or redistributing this code is not permitted (see LICENSE).
#include "webview/webview.h"

extern "C" void cup_menu_cb(int tag);

#if defined(__APPLE__)
#include <objc/message.h>
#include <objc/runtime.h>

namespace {
using webview::detail::objc::msg_send;
using webview::detail::objc::selector;
inline id cls(const char *n) { return (id)objc_getClass(n); }
inline id str(const char *s) { return msg_send<id>(cls("NSString"), selector("stringWithUTF8String:"), s); }

id g_target = nullptr;

id item(const char *title, const char *action, const char *key, unsigned long mods, long tag, bool custom) {
  id it = msg_send<id>(msg_send<id>(cls("NSMenuItem"), selector("alloc")), selector("initWithTitle:action:keyEquivalent:"),
                       str(title), selector(custom ? "cupMenu:" : action), str(key));
  if (mods) msg_send<void>(it, selector("setKeyEquivalentModifierMask:"), mods);
  if (custom) {
    msg_send<void>(it, selector("setTarget:"), g_target);
    msg_send<void>(it, selector("setTag:"), tag);
  }
  return it;
}
id sep() { return msg_send<id>(cls("NSMenuItem"), selector("separatorItem")); }
id menu(const char *title) {
  return msg_send<id>(msg_send<id>(cls("NSMenu"), selector("alloc")), selector("initWithTitle:"), str(title));
}
void add(id m, id it) { msg_send<void>(m, selector("addItem:"), it); }
id top(id bar, const char *title) {
  id holder = item(title, "", "", 0, 0, false);
  id m = menu(title);
  msg_send<void>(holder, selector("setSubmenu:"), m);
  add(bar, holder);
  return m;
}
const unsigned long CMD = 1ul << 20, SHIFT = 1ul << 17, OPT = 1ul << 19;
}  // namespace

extern "C" void cup_native_setup(void *) {
  Class c = objc_lookUpClass("CupMenuTarget");
  if (!c) {
    c = objc_allocateClassPair((Class)cls("NSObject"), "CupMenuTarget", 0);
    class_addMethod(c, selector("cupMenu:"), (IMP)(+[](id, SEL, id sender) {
                      cup_menu_cb((int)msg_send<long>(sender, selector("tag")));
                    }), "v@:@");
    objc_registerClassPair(c);
  }
  g_target = msg_send<id>((id)c, selector("new"));
  id app = msg_send<id>(cls("NSApplication"), selector("sharedApplication"));
  id bar = menu("");
  id a = top(bar, "Cup");
  add(a, item("About Cup", "", "", 0, 1, true));
  add(a, item("Check for Updates…", "", "", 0, 2, true));
  add(a, sep());
  add(a, item("Settings…", "", ",", CMD, 3, true));
  add(a, sep());
  add(a, item("Hide Cup", "hide:", "h", CMD, 0, false));
  add(a, item("Hide Others", "hideOtherApplications:", "h", CMD | OPT, 0, false));
  add(a, item("Show All", "unhideAllApplications:", "", 0, 0, false));
  add(a, sep());
  add(a, item("Quit Cup", "terminate:", "q", CMD, 0, false));
  id e = top(bar, "Edit");
  add(e, item("Undo", "undo:", "z", CMD, 0, false));
  add(e, item("Redo", "redo:", "z", CMD | SHIFT, 0, false));
  add(e, sep());
  add(e, item("Cut", "cut:", "x", CMD, 0, false));
  add(e, item("Copy", "copy:", "c", CMD, 0, false));
  add(e, item("Paste", "paste:", "v", CMD, 0, false));
  add(e, item("Select All", "selectAll:", "a", CMD, 0, false));
  add(e, sep());
  add(e, item("Find…", "", "f", CMD, 4, true));
  id v = top(bar, "View");
  add(v, item("Command Palette…", "", "k", CMD, 5, true));
  add(v, item("Discover", "", "1", CMD, 11, true));
  add(v, item("Installed", "", "2", CMD, 12, true));
  add(v, item("Updates", "", "3", CMD, 13, true));
  add(v, item("Maintenance", "", "4", CMD, 14, true));
  add(v, item("Log", "", "l", CMD | SHIFT, 15, true));
  add(v, sep());
  add(v, item("Refresh", "", "r", CMD, 6, true));
  id w = top(bar, "Window");
  add(w, item("Minimize", "performMiniaturize:", "m", CMD, 0, false));
  add(w, item("Zoom", "performZoom:", "", 0, 0, false));
  add(w, item("Close", "performClose:", "w", CMD, 0, false));
  id h = top(bar, "Help");
  add(h, item("Keyboard Shortcuts", "", "/", CMD, 7, true));
  add(h, item("Cup on the Web", "", "", 0, 8, true));
  add(h, item("Star Cup on GitHub", "", "", 0, 9, true));
  msg_send<void>(app, selector("setMainMenu:"), bar);
  msg_send<void>(app, selector("setWindowsMenu:"), w);
}

extern "C" void cup_native_badge(const char *label) {
  id app = msg_send<id>(cls("NSApplication"), selector("sharedApplication"));
  id tile = msg_send<id>(app, selector("dockTile"));
  msg_send<void>(tile, selector("setBadgeLabel:"), (label && *label) ? str(label) : (id) nullptr);
}

extern "C" void cup_native_front(void *) {
  id app = msg_send<id>(cls("NSApplication"), selector("sharedApplication"));
  msg_send<void>(app, selector("activateIgnoringOtherApps:"), (signed char)1);
}
#else
extern "C" void cup_native_setup(void *) {}
extern "C" void cup_native_badge(const char *) {}
extern "C" void cup_native_front(void *) {}
#endif

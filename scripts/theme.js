(function initMomentumTheme() {
    const getHashTheme = () => {
      const raw = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

      if (!raw) {
        return null;
      }

      const theme = new URLSearchParams(raw).get("theme");
      return theme === "light" || theme === "dark" ? theme : null;
    };

    const apply = () => {
      const forcedTheme = getHashTheme();
      const dark = forcedTheme
        ? forcedTheme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      const root = document.documentElement;

      root.classList.remove(
        "mds-theme-stable-lightWebex",
        "mds-theme-stable-darkWebex",
      );
      root.classList.add(
        dark ? "mds-theme-stable-darkWebex" : "mds-theme-stable-lightWebex",
      );
      // Always declare support for BOTH schemes (dark first when dark) so the
      // browser's "Auto Dark Mode for Web Contents" does not re-tint the page.
      // A light-only ("color-scheme: light") signal is what triggers it.
      root.style.colorScheme = dark ? "dark light" : "light dark";
    };

    apply();
    window.addEventListener("hashchange", apply);
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (!getHashTheme()) {
          apply();
        }
      });
  })();

  /**
 * Theme selector: toggles the menu and applies System / Light / Dark themes.
 * Light/Dark are persisted via the URL hash (read by the inline boot script),
 * while System clears the hash and follows the OS preference.
 */
(function initThemeSelect() {
    const root = document.documentElement;
    const select = document.getElementById("theme-select");
    const button = document.getElementById("theme-select-button");
    const menu = document.getElementById("theme-select-menu");
    const label = document.getElementById("theme-select-label");
    const currentIcon = document.getElementById("theme-select-current-icon");
  
    if (!select || !button || !menu || !label || !currentIcon) {
      return;
    }
  
    const options = Array.from(menu.querySelectorAll(".theme-select-option"));
  
    const META = {
      system: { label: "System", icon: "icon-laptop-regular" },
      light: { label: "Light", icon: "icon-brightness-high-filled" },
      dark: { label: "Dark", icon: "icon-quiet-hours-presence-filled" },
    };
    const ICON_CLASSES = Object.values(META).map((meta) => meta.icon);
  
    const readChoice = () => {
      const raw = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const theme = raw ? new URLSearchParams(raw).get("theme") : null;
      return theme === "light" || theme === "dark" ? theme : "system";
    };
  
    const applyTheme = (choice) => {
      const dark =
        choice === "dark" ||
        (choice === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
  
      root.classList.remove(
        "mds-theme-stable-lightWebex",
        "mds-theme-stable-darkWebex",
      );
      root.classList.add(
        dark ? "mds-theme-stable-darkWebex" : "mds-theme-stable-lightWebex",
      );
      // Declare support for both schemes (dark first when dark) so the browser's
      // "Auto Dark Mode for Web Contents" leaves our explicit colors alone; a
      // light-only "color-scheme: light" is what lets it force-darken the page.
      root.style.colorScheme = dark ? "dark light" : "light dark";
    };
  
    const syncButton = (choice) => {
      const meta = META[choice] || META.system;
      label.textContent = meta.label;
      currentIcon.classList.remove(...ICON_CLASSES);
      currentIcon.classList.add(meta.icon);
      options.forEach((option) => {
        option.setAttribute(
          "aria-selected",
          String(option.dataset.themeChoice === choice),
        );
      });
    };
  
    const setChoice = (choice) => {
      if (choice === "system") {
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      } else {
        window.location.hash = "theme=" + choice;
      }
      applyTheme(choice);
      syncButton(choice);
    };
  
    const openMenu = () => {
      menu.hidden = false;
      select.dataset.open = "true";
      button.setAttribute("aria-expanded", "true");
    };
  
    const closeMenu = () => {
      menu.hidden = true;
      select.dataset.open = "false";
      button.setAttribute("aria-expanded", "false");
    };
  
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menu.hidden) {
        openMenu();
      } else {
        closeMenu();
      }
    });
  
    options.forEach((option) => {
      option.addEventListener("click", () => {
        setChoice(option.dataset.themeChoice);
        closeMenu();
        button.focus();
      });
    });
  
    document.addEventListener("click", (event) => {
      if (!select.contains(event.target)) {
        closeMenu();
      }
    });
  
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        closeMenu();
        button.focus();
      }
    });
  
    syncButton(readChoice());
  })();
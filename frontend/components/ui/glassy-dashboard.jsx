"use client";

import { Avatar, Button, Label, Link, SearchField, Surface, Switch, Tooltip } from "@heroui/react";
import {
  ArrowLeftToLine, ArrowRightFromLine, BookOpen, CalendarDays, ClipboardCheck,
  CodeXml, LayoutDashboard, MessageSquareText, Moon, UserMinus, UserPlus, Users, Workflow,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const THEME_KEY = "employees-dashboard-theme";
const OVERVIEW = { id: "overview", label: "Overview", icon: LayoutDashboard };
const EMPLOYEE_SEARCH = { id: "employee-search", label: "Employee search", icon: Users };

export const WORKSHEET_VIEWS = [
  { id: "monthly-employee-data", label: "Monthly Employee Data", icon: CalendarDays },
  { id: "attrition-events", label: "Attrition Events", icon: UserMinus },
  { id: "engagement-surveys", label: "Engagement Surveys", icon: MessageSquareText },
  { id: "performance-reviews", label: "Performance Reviews", icon: ClipboardCheck },
  { id: "recruitment", label: "Recruitment", icon: UserPlus },
  { id: "data-dictionary", label: "Data Dictionary", icon: BookOpen },
  { id: "advanced-analysis", label: "Advanced Analysis", icon: Workflow },
];

function SidebarLink({ item: { id, label, icon: Icon }, activeView, expanded, onPress }) {
  return (
    <Tooltip isDisabled={expanded} delay={300}>
      <Link
        className="sidebar-link"
        href={`#${id}`}
        aria-label={label}
        aria-current={activeView === id ? "page" : undefined}
        onPress={onPress}
      >
        <Icon aria-hidden="true" />
        <span className="sidebar-label">{label}</span>
      </Link>
      <Tooltip.Content placement="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}

export function GlassyDashboard({ children, activeView, openSearch, openDevTools, devtoolsOpen, devtools }) {
  const [theme, setTheme] = useState("light");
  const [expanded, setExpanded] = useState(true);
  const [worksheetSearch, setWorksheetSearch] = useState("");
  const mainPanel = useRef(null);
  const dark = theme === "dark";
  const matchingWorksheets = WORKSHEET_VIEWS.filter(({ label }) =>
    label.toLowerCase().includes(worksheetSearch.trim().toLowerCase())
  );

  useEffect(() => {
    if (matchMedia("(max-width: 48rem)").matches) setExpanded(false);
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    } else if (matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useLayoutEffect(() => {
    const panel = mainPanel.current;
    panel.scrollTop = 0;
    const target = document.getElementById(window.location.hash.slice(1));
    if (activeView === OVERVIEW.id && panel.contains(target)) {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [activeView]);

  function changeTheme(isDark) {
    const nextTheme = isDark ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  }

  function closeMobileNavigation(event) {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      && matchMedia("(max-width: 48rem)").matches) {
      setExpanded(false);
      setWorksheetSearch("");
      mainPanel.current?.querySelector("h1")?.focus({ preventScroll: true });
    }
  }

  return (
    <div className="workspace">
      <div className="shell" data-sidebar-expanded={expanded}>
        <Surface className="workspace-sidebar" render={(props) => <aside {...props} />}>
          <div className="workspace-brand">
            <Avatar className="workspace-symbol" aria-hidden="true" size="sm">
              <Avatar.Fallback>PA</Avatar.Fallback>
            </Avatar>
            <span className="workspace-brand-name">People Analytics</span>
            <Button
              isIconOnly
              variant="ghost"
              className="sidebar-toggle"
              aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
              aria-expanded={expanded}
              aria-controls="sidebar-navigation"
              onPress={() => {
                setExpanded(!expanded);
                if (expanded) setWorksheetSearch("");
              }}
            >
              {expanded ? <ArrowLeftToLine aria-hidden="true" /> : <ArrowRightFromLine aria-hidden="true" />}
            </Button>
          </div>

          <div className="sidebar-content" id="sidebar-navigation">
            <nav className="workspace-nav" aria-label="Dashboard navigation">
              <SidebarLink item={OVERVIEW} activeView={activeView} expanded={expanded} onPress={closeMobileNavigation} />
              <div className="sidebar-worksheets">
                <p className="sidebar-group-label sidebar-label">Worksheets</p>
                {expanded && (
                  <SearchField
                    className="sidebar-search"
                    aria-label="Find a worksheet"
                    variant="secondary"
                    value={worksheetSearch}
                    onChange={setWorksheetSearch}
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="Find a worksheet" />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                )}
                <ul aria-label="Worksheets">
                  {matchingWorksheets.map((item) => (
                    <li key={item.id}>
                      <SidebarLink item={item} activeView={activeView} expanded={expanded} onPress={closeMobileNavigation} />
                    </li>
                  ))}
                </ul>
                {matchingWorksheets.length === 0 && <p className="sidebar-empty" role="status">No matching worksheets.</p>}
              </div>
            </nav>
            <div className="sidebar-utilities">
              <nav aria-label="Dashboard tools">
                <SidebarLink item={EMPLOYEE_SEARCH} expanded={expanded} onPress={openSearch} />
                <Tooltip isDisabled={expanded} delay={300}>
                  <Button
                    variant="ghost"
                    className="sidebar-link"
                    aria-label="Open DevTools"
                    aria-expanded={devtoolsOpen}
                    aria-controls="dashboard-devtools"
                    onPress={openDevTools}
                  >
                    <CodeXml aria-hidden="true" />
                    <span className="sidebar-label">DevTools</span>
                  </Button>
                  <Tooltip.Content placement="right">DevTools</Tooltip.Content>
                </Tooltip>
              </nav>
              <Switch aria-label="Dark mode" className="theme-toggle" size="sm" isSelected={dark} onChange={changeTheme}>
                <Switch.Content>
                  <Label><Moon aria-hidden="true" /><span className="sidebar-label">Dark mode</span></Label>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch.Content>
              </Switch>
            </div>
          </div>
        </Surface>
        <Surface ref={mainPanel} className="workspace-stage" tabIndex={0} render={(props) => <main {...props} />}>
          {children}
        </Surface>
      </div>
      {devtools}
    </div>
  );
}

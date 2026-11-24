"use client";

import { Button, Disclosure, DisclosureGroup } from "@heroui/react";
import type { CSSProperties } from "react";

type Branch = {
  key: string;
  label: string;
  children: { key: string; label: string }[];
};

type BranchedMenuProps = {
  label: string;
  branches: Branch[];
  defaultOpen: string;
  selected: string;
  onSelect: (key: string) => void;
};

const ROW_HEIGHT = 38;
const INDENT = 34;
const TRUNK = 12;
const RADIUS = 8;

function BranchLines({ children, selected }: Pick<Branch, "children"> & { selected: string }) {
  const rowY = (index: number) => ROW_HEIGHT * (index + 0.5);
  const bend = (index: number) => `A ${RADIUS} ${RADIUS} 0 0 0 ${TRUNK + RADIUS} ${rowY(index)} H ${INDENT - 3}`;
  return (
    <svg className="branched-menu-lines" width={INDENT} height={children.length * ROW_HEIGHT} aria-hidden="true">
      <path d={`M ${TRUNK} 0 V ${rowY(children.length - 1) - RADIUS}`} />
      {children.map(({ key }, index) => (
        <path key={key} d={`M ${TRUNK} ${rowY(index) - RADIUS} ${bend(index)}`} />
      ))}
      {children.map(({ key }, index) => (
        <path key={key} className="branched-menu-active-line" data-current={key === selected}
          d={`M ${TRUNK} 0 V ${rowY(index) - RADIUS} ${bend(index)}`} pathLength={1} />
      ))}
    </svg>
  );
}

export function BranchedMenu({ label, branches, defaultOpen, selected, onSelect }: BranchedMenuProps) {
  const dimensions = { "--branch-row": `${ROW_HEIGHT}px`, "--branch-indent": `${INDENT}px` } as CSSProperties;

  return (
    <nav className="branched-menu" aria-label={label} style={dimensions}>
      <DisclosureGroup allowsMultipleExpanded defaultExpandedKeys={[defaultOpen]}>
        {branches.map(({ key, label, children }) => (
          <Disclosure id={key} key={key}>
            <Disclosure.Heading>
              <Disclosure.Trigger className="branched-menu-trigger" data-current={children.some((item) => item.key === selected)}>
                {label}<Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="branched-menu-body">
                <div className="branched-menu-branch">
                  <BranchLines children={children} selected={selected} />
                  <ul>
                    {children.map(({ key, label }) => (
                      <li key={key}>
                        <Button className="branched-menu-position" variant="ghost" aria-current={key === selected || undefined}
                          onPress={() => onSelect(key)}>
                          {label}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        ))}
      </DisclosureGroup>
    </nav>
  );
}

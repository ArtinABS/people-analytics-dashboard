"use client";

import { DateField, DateRangePicker, FieldError, Label, RangeCalendar } from "@heroui/react";

export function DateRangeFilter({ name, label, ...props }) {
  return (
    <DateRangePicker {...props} className="filter" startName={`${name}_from`} endName={`${name}_to`}>
      <Label>{label}</Label>
      <DateField.Group className="w-full min-w-0 min-h-11 border border-border shadow-none max-[380px]:h-auto">
        <DateField.InputContainer className="max-[380px]:flex-col max-[380px]:items-stretch">
          <DateField.Input slot="start" className="ps-2 text-sm">
            {(segment) => <DateField.Segment segment={segment} />}
          </DateField.Input>
          <DateRangePicker.RangeSeparator className="max-[380px]:hidden" />
          <DateField.Input slot="end" className="pe-0 text-sm max-[380px]:border-t max-[380px]:border-border max-[380px]:ps-2">
            {(segment) => <DateField.Segment segment={segment} />}
          </DateField.Input>
        </DateField.InputContainer>
        <DateField.Suffix className="me-0.5">
          <DateRangePicker.Trigger className="size-10 justify-center">
            <DateRangePicker.TriggerIndicator />
          </DateRangePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <FieldError />
      <DateRangePicker.Popover className="z-10 border border-border bg-overlay text-foreground">
        <RangeCalendar aria-label={`${label} calendar`}>
          <RangeCalendar.Header>
            <RangeCalendar.YearPickerTrigger>
              <RangeCalendar.YearPickerTriggerHeading />
              <RangeCalendar.YearPickerTriggerIndicator />
            </RangeCalendar.YearPickerTrigger>
            <RangeCalendar.NavButton slot="previous" />
            <RangeCalendar.NavButton slot="next" />
          </RangeCalendar.Header>
          <RangeCalendar.Grid>
            <RangeCalendar.GridHeader>
              {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
            </RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>
              {(date) => <RangeCalendar.Cell date={date} />}
            </RangeCalendar.GridBody>
          </RangeCalendar.Grid>
          <RangeCalendar.YearPickerGrid>
            <RangeCalendar.YearPickerGridBody>
              {({ year }) => <RangeCalendar.YearPickerCell year={year} />}
            </RangeCalendar.YearPickerGridBody>
          </RangeCalendar.YearPickerGrid>
        </RangeCalendar>
      </DateRangePicker.Popover>
    </DateRangePicker>
  );
}

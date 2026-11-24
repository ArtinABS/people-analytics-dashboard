"use client";

import { Alert, Button, Input, Modal, Tooltip } from "@heroui/react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { fetchEmployeeJson } from "../../app/employee-request";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function WorkbookImport({ expanded, onImported }) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [upload, setUpload] = useState(null);
  const input = useRef(null);
  const pending = upload?.status === "pending";
  const result = upload?.status === "success" ? upload.result : null;

  function changeOpen(open) {
    if (pending) return;
    setIsOpen(open);
    if (open) {
      setFile(null);
      setUpload(null);
    }
  }

  function chooseFile(event) {
    const nextFile = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!nextFile) return;
    setFile(null);
    if (!nextFile.name.toLowerCase().endsWith(".xlsx")) {
      setUpload({ status: "error", message: "Choose an .xlsx workbook." });
    } else if (nextFile.size > MAX_FILE_SIZE) {
      setUpload({ status: "error", message: "Choose an .xlsx workbook of 20 MB or less." });
    } else {
      setFile(nextFile);
      setUpload(null);
    }
  }

  async function importWorkbook() {
    if (!file || pending) return;
    const body = new FormData();
    body.set("file", file);
    setUpload({ status: "pending" });
    try {
      const result = await fetchEmployeeJson("/imports/workbook", undefined, body);
      setUpload({ status: "success", result });
      onImported();
    } catch (error) {
      setUpload({ status: "error", message: error.message });
    }
  }

  return (
    <>
      <Tooltip isDisabled={expanded} delay={300}>
        <Button
          variant="ghost"
          className="sidebar-link"
          aria-label="Import Excel"
          aria-haspopup="dialog"
          onPress={() => changeOpen(true)}
        >
          <Upload aria-hidden="true" />
          <span className="sidebar-label">Import Excel</span>
        </Button>
        <Tooltip.Content placement="right">Import Excel</Tooltip.Content>
      </Tooltip>

      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={changeOpen}
        isDismissable={!pending}
        isKeyboardDismissDisabled={pending}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Import Excel</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3 text-sm">
              {result ? (
                <Alert status="success">
                  <Alert.Indicator />
                  <Alert.Content className="min-w-0">
                    <Alert.Title>Workbook imported</Alert.Title>
                    <Alert.Description className="wrap-anywhere">
                      {result.total.toLocaleString()} employee {result.total === 1 ? "record" : "records"} loaded from {result.workbook}.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : (
                <>
                  <p className="text-muted">
                    Use an .xlsx file with the same sheet names and columns as PA Task.xlsx. Importing replaces the current dashboard data.
                  </p>
                  <Input
                    ref={input}
                    type="file"
                    accept=".xlsx"
                    aria-label="Excel workbook file"
                    className="hidden"
                    onChange={chooseFile}
                  />
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                    <FileSpreadsheet className="size-5 shrink-0 text-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1 basis-28">
                      <p className="wrap-anywhere font-semibold">{file?.name || "Excel workbook"}</p>
                      <p className="text-xs text-muted">.xlsx, up to 20 MB</p>
                    </div>
                    <Button isDisabled={pending} variant="secondary" size="sm" onPress={() => input.current?.click()}>
                      {file ? "Change file" : "Choose file"}
                    </Button>
                  </div>
                  {upload?.status === "error" && (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>Import failed</Alert.Title>
                        <Alert.Description className="wrap-anywhere">{upload.message}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              {result ? (
                <Button onPress={() => changeOpen(false)}>Done</Button>
              ) : (
                <>
                  <Button variant="secondary" isDisabled={pending} onPress={() => changeOpen(false)}>Cancel</Button>
                  <Button isDisabled={!file} isPending={pending} onPress={importWorkbook}>
                    {pending ? "Importing…" : "Import workbook"}
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

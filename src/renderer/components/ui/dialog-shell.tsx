import * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type HeaderProps = React.HTMLAttributes<HTMLElement>;
type FooterProps = React.HTMLAttributes<HTMLElement>;
type TitleProps = React.HTMLAttributes<HTMLHeadingElement>;
type DescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export interface DialogShellProps extends Omit<DivProps, "title" | "content"> {
  surfaceProps?: DivProps;
  headerProps?: HeaderProps;
  contentProps?: DivProps;
  footerProps?: FooterProps;
  titleProps?: TitleProps;
  descriptionProps?: DescriptionProps;
  title?: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  header?: React.ReactNode;
  content?: React.ReactNode;
  footer?: React.ReactNode;
  contentScrollable?: boolean;
}

export function DialogShell({
  className,
  surfaceProps,
  headerProps,
  contentProps,
  footerProps,
  titleProps,
  descriptionProps,
  title,
  description,
  leading,
  trailing,
  header,
  content,
  footer,
  contentScrollable = true,
  children,
  ...rootProps
}: DialogShellProps) {
  const {
    className: surfaceClassName,
    ...surfaceRestProps
  } = surfaceProps ?? {};
  const {
    className: headerClassName,
    ...headerRestProps
  } = headerProps ?? {};
  const {
    className: contentClassName,
    ...contentRestProps
  } = contentProps ?? {};
  const {
    className: footerClassName,
    ...footerRestProps
  } = footerProps ?? {};
  const {
    className: titleClassName,
    ...titleRestProps
  } = titleProps ?? {};
  const {
    className: descriptionClassName,
    ...descriptionRestProps
  } = descriptionProps ?? {};

  const contentNode = content ?? children;
  const hasDefaultHeader = title || description || leading || trailing;
  const headerNode = header ?? (hasDefaultHeader ? (
    <div className="flex min-w-0 items-start justify-between gap-4">
      <div className="min-w-0">
        {title ? (
          <h1
            className={cn("text-lg font-semibold tracking-tight", titleClassName)}
            {...titleRestProps}
          >
            {title}
          </h1>
        ) : null}
        {description ? (
          <p
            className={cn("mt-1 text-sm leading-6", descriptionClassName)}
            {...descriptionRestProps}
          >
            {description}
          </p>
        ) : null}
      </div>
      {(leading || trailing) ? (
        <div className="flex shrink-0 items-center gap-2">
          {leading}
          {trailing}
        </div>
      ) : null}
    </div>
  ) : null);

  return (
    <div
      className={cn("h-screen w-screen overflow-hidden", className)}
      {...rootProps}
    >
      <div
        className={cn(
          "grid h-full w-full grid-rows-[auto,minmax(0,1fr),auto] overflow-hidden",
          surfaceClassName,
        )}
        {...surfaceRestProps}
      >
        {headerNode ? (
          <header
            className={cn("shrink-0", headerClassName)}
            {...headerRestProps}
          >
            {headerNode}
          </header>
        ) : null}

        {contentNode ? (
          <div
            className={cn(
              "min-h-0",
              contentScrollable ? "overflow-y-auto" : "overflow-hidden",
              contentClassName,
            )}
            {...contentRestProps}
          >
            {contentNode}
          </div>
        ) : null}

        {footer ? (
          <footer
            className={cn("shrink-0", footerClassName)}
            {...footerRestProps}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

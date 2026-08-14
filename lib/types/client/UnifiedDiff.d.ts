import type { ProducedFileDiff as DiffHunk } from './turn-deliverables.ts';
/** Locale labels required by the review diff. */
export interface UnifiedDiffLabels {
    readonly copy: string;
    readonly copied: string;
    readonly showUnchanged: (count: number) => string;
    readonly hideUnchanged: (count: number) => string;
}
interface UnifiedDiffProps {
    readonly diffs: readonly DiffHunk[];
    readonly contextLines: number;
    readonly labels: UnifiedDiffLabels;
    readonly className?: string | undefined;
}
/**
 * Render line-aligned hunks with old/new gutters and expandable context gaps.
 * @param props - Unified diff data, locale labels, and presentation options.
 * @returns The line-numbered unified diff surface.
 */
export declare function UnifiedDiff({ diffs, contextLines, labels, className }: UnifiedDiffProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=UnifiedDiff.d.ts.map
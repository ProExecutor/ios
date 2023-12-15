import { OperationalError } from '../errors';
import { SwipeMove } from '../api/recorder';

export interface SwipeGestureArgs {
    duration?: number;
    stepDuration?: number;
}

export class SwipeGesture {
    private moves: Movement[] = [];
    private duration?: number;
    private stepDuration: number;

    constructor({ duration, stepDuration }: SwipeGestureArgs) {
        this.duration = duration;
        this.stepDuration = stepDuration ?? 16;

        this.moves = [{ x: 0, y: 0 }];
    }

    to(x: string, y: string) {
        if (typeof x !== 'string' || typeof y !== 'string') {
            throw new OperationalError(
                'x and y must be strings and in percentages (e.g. "50%")'
            );
        }

        if (!x.endsWith('%') || !y.endsWith('%')) {
            throw new OperationalError(
                'x and y must be in percentages (e.g. "50%")'
            );
        }

        this.moves.push({
            x: parseFloat(x) / 100,
            y: parseFloat(y) / 100,
        });

        return this;
    }

    // undecided if we want to support this
    // move(x: string, y: string) {
    //     if (typeof x !== 'string' || typeof y !== 'string') {
    //         throw new Error(
    //             'x and y must be strings and in percentages (e.g. "50%")'
    //         );
    //     }

    //     if (!x.endsWith('%') || !y.endsWith('%')) {
    //         throw new Error('x and y must be in percentages (e.g. "50%")');
    //     }

    //     const previous = this.moves[this.moves.length - 1];

    //     this.moves.push({
    //         x: (previous?.x ?? 0) + parseFloat(x) / 100,
    //         y: (previous?.y ?? 0) + parseFloat(y) / 100,
    //     });

    //     return this;
    // }

    wait(duration: number) {
        const previous = this.moves[this.moves.length - 1];
        if (previous) {
            previous.wait = duration + (previous.wait ?? 0);
        }

        return this;
    }

    build() {
        const stepDuration = this.stepDuration;

        const duration =
            this.duration ??
            Math.max(500, stepDuration * (this.moves.length - 1));

        const totalSteps = Math.floor(duration / stepDuration);
        const stepsPerSegment = Math.floor(
            totalSteps / (this.moves.length - 1)
        );

        const result: SwipeMove[] = [];
        let accruedWaitTime = 0;

        if (stepsPerSegment === 0) {
            const requiredDuration = (this.moves.length - 1) * stepDuration;

            throw new Error(
                `Duration is too short for ${
                    this.moves.length - 1
                } moves, please set duration to at least ${requiredDuration}ms`
            );
        }

        for (let i = 0; i < this.moves.length - 1; i++) {
            const lowerCoord = this.moves[i];
            const upperCoord = this.moves[i + 1];
            const isLastPair = i === this.moves.length - 2;

            for (let step = 0; step <= stepsPerSegment; step++) {
                // Skip the last step for all pairs except the final one to prevent duplicates
                if (!isLastPair && step === stepsPerSegment) continue;

                const progress = step / stepsPerSegment;
                const interpolatedX =
                    lowerCoord.x + progress * (upperCoord.x - lowerCoord.x);
                const interpolatedY =
                    lowerCoord.y + progress * (upperCoord.y - lowerCoord.y);
                const t =
                    ((i * stepsPerSegment + step) * stepDuration +
                        accruedWaitTime) /
                    1000;

                result.push({ x: interpolatedX, y: interpolatedY, t });

                // If the current pair has a wait time, add duplicate point
                // with extended ts
                if (step === 0 && lowerCoord.wait) {
                    result.push({
                        x: interpolatedX,
                        y: interpolatedY,
                        t: t + lowerCoord.wait / 1000,
                    });
                    accruedWaitTime += lowerCoord.wait;
                }
            }

            // if the last move was a wait, duplicate the last point and extend the ts
            if (i === this.moves.length - 2 && upperCoord.wait) {
                const lastResult = result[result.length - 1];
                result.push({
                    x: lastResult.x,
                    y: lastResult.y,
                    t: lastResult.t + upperCoord.wait / 1000,
                });
            }
        }
        return result;
    }

    up(distance = '50%') {
        const value = parseFloat(distance);
        return this.to('0%', `-${value}%`);
    }

    down(distance = '50%') {
        const value = parseFloat(distance);
        return this.to('0%', `${value}%`);
    }

    left(distance = '50%') {
        const value = parseFloat(distance);
        return this.to(`-${value}%`, '0%');
    }

    right(distance = '50%') {
        const value = parseFloat(distance);
        return this.to(`${value}%`, '0%');
    }
}

interface Movement {
    x: number;
    y: number;
    wait?: number;
}

"""Entrada do executavel grafico; worker usa a mesma CLI sem exigir Python."""
import sys
import traceback

from install import main


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--worker':
        output = sys.argv[2]
        sys.argv = [sys.argv[0], *sys.argv[3:]]
        with open(output, 'w', encoding='utf-8') as stream:
            sys.stdout = sys.stderr = stream
            try:
                main()
            except Exception:
                traceback.print_exc()
                sys.exit(1)
    else:
        from gui import launch
        launch()

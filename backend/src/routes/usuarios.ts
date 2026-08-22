import { Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { pool } from '../db/pool';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { atualizarUsuarioSchema, atualizarVinculosUsuarioSchema, criarUsuarioSchema, redefinirSenhaUsuarioSchema } from '../validation/schemas';
import { hashPassword } from '../services/authService';
import { registrarAuditoria } from '../services/auditService';
import { revogarSessoesUsuario } from '../services/sessionService';

function idsUnicos(ids: number[]): number[] {
  return [...new Set(ids.map(Number))];
}

async function empresasExistem(empresaIds: number[]): Promise<boolean> {
  if (empresaIds.length === 0) return true;
  const [rows]: any = await pool.query(
    `SELECT id FROM empresas WHERE id IN (?)`,
    [empresaIds]
  );
  return rows.length === empresaIds.length;
}

export function criarUsuariosRouter(io: SocketServer) {
  const router = Router();

  router.use(authMiddleware, requireRole('admin'));

  router.get('/', async (_req, res) => {
    const [usuarios]: any = await pool.query(
      `SELECT id, username, role, ativo, criado_em FROM usuarios ORDER BY username`
    );
    const [vinculos]: any = await pool.query(
      `SELECT usuario_id, empresa_id FROM usuario_empresas
       WHERE ativo = TRUE ORDER BY usuario_id, empresa_id`
    );
    const porUsuario = new Map<number, number[]>();
    for (const vinculo of vinculos) {
      const atual = porUsuario.get(Number(vinculo.usuario_id)) ?? [];
      atual.push(Number(vinculo.empresa_id));
      porUsuario.set(Number(vinculo.usuario_id), atual);
    }

    res.json(usuarios.map((usuario: any) => ({
      ...usuario,
      empresa_ids: porUsuario.get(Number(usuario.id)) ?? [],
    })));
  });

  router.post('/', validateBody(criarUsuarioSchema), async (req, res) => {
    const { username, password, role } = req.body;
    const empresaIds = role === 'admin' ? [] : idsUnicos(req.body.empresa_ids ?? []);

    const [existentes]: any = await pool.query(`SELECT id FROM usuarios WHERE username = ?`, [username]);
    if (existentes.length > 0) {
      return res.status(409).json({ erro: 'Já existe um usuário com esse nome' });
    }
    if (!(await empresasExistem(empresaIds))) {
      return res.status(400).json({ erro: 'Uma ou mais empresas informadas não existem' });
    }

    const hash = await hashPassword(password);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result]: any = await connection.query(
        `INSERT INTO usuarios (username, senha_hash, role) VALUES (?, ?, ?) RETURNING id`,
        [username, hash, role]
      );
      const novoUsuarioId = Number(result[0].id);
      if (empresaIds.length > 0) {
        const valores = empresaIds.map(() => '(?, ?, ?)').join(', ');
        await connection.query(
          `INSERT INTO usuario_empresas (usuario_id, empresa_id, ativo) VALUES ${valores}`,
          empresaIds.flatMap((empresaId) => [novoUsuarioId, empresaId, true])
        );
      }
      await connection.commit();

      await registrarAuditoria(
        req.user!.username,
        'criar',
        'usuario',
        novoUsuarioId,
        `Criou usuário "${username}" (${role})`,
        req.ip,
        { usuarioId: req.user!.id }
      );
      res.status(201).json({
        id: novoUsuarioId,
        username,
        role,
        ativo: true,
        empresa_ids: empresaIds,
      });
    } catch (erro) {
      await connection.rollback();
      throw erro;
    } finally {
      connection.release();
    }
  });

  router.put('/:id', validateBody(atualizarUsuarioSchema), async (req, res) => {
    const alvoId = Number(req.params.id);
    if (!Number.isInteger(alvoId) || alvoId <= 0) {
      return res.status(400).json({ erro: 'Usuario invalido.' });
    }

    const [alvos]: any = await pool.query(
      `SELECT id, username FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1`,
      [alvoId]
    );
    const alvo = alvos[0];
    if (!alvo) return res.status(404).json({ erro: 'Usuario nao encontrado.' });

    const username = req.body.username;
    const novaSenha: string | undefined = req.body.nova_senha;
    const [duplicados]: any = await pool.query(
      `SELECT id FROM usuarios WHERE username = ? AND id <> ? LIMIT 1`,
      [username, alvoId]
    );
    if (duplicados.length > 0) {
      return res.status(409).json({ erro: 'Ja existe um usuario com esse nome.' });
    }

    const hash = novaSenha ? await hashPassword(novaSenha) : null;
    if (hash) {
      await pool.query(
        `UPDATE usuarios SET username = ?, senha_hash = ?, sessao_versao = sessao_versao + 1 WHERE id = ?`,
        [username, hash, alvoId]
      );
      await revogarSessoesUsuario(alvoId);
      io.in(`usuario_${alvoId}`).disconnectSockets(true);
    } else {
      await pool.query(`UPDATE usuarios SET username = ? WHERE id = ?`, [username, alvoId]);
    }

    const alteracoes = [
      alvo.username !== username ? `nome de usuario: "${alvo.username}" para "${username}"` : null,
      hash ? 'senha redefinida' : null,
    ].filter(Boolean).join('; ') || 'nenhuma alteracao';
    await registrarAuditoria(
      req.user!.username,
      'editar',
      'usuario',
      alvoId,
      `Atualizou usuario "${username}" (${alteracoes})`,
      req.ip,
      { usuarioId: req.user!.id }
    );

    res.json({ ok: true, id: alvoId, username, senha_alterada: Boolean(hash) });
  });

  router.put('/:id/empresas', validateBody(atualizarVinculosUsuarioSchema), async (req, res) => {
    const alvoId = Number(req.params.id);
    if (!Number.isInteger(alvoId) || alvoId <= 0) {
      return res.status(400).json({ erro: 'Usuário inválido' });
    }
    const empresaIds = idsUnicos(req.body.empresa_ids);
    if (!(await empresasExistem(empresaIds))) {
      return res.status(400).json({ erro: 'Uma ou mais empresas informadas não existem' });
    }

    const [alvos]: any = await pool.query(`SELECT id, username, role FROM usuarios WHERE id = ?`, [alvoId]);
    if (alvos.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const [atuais]: any = await pool.query(
      `SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ? AND ativo = TRUE`,
      [alvoId]
    );
    const atuaisIds = atuais.map((v: any) => Number(v.empresa_id));
    const removidos = atuaisIds.filter((empresaId: number) => !empresaIds.includes(empresaId));
    const adicionados = empresaIds.filter((empresaId) => !atuaisIds.includes(empresaId));

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`UPDATE usuario_empresas SET ativo = FALSE WHERE usuario_id = ?`, [alvoId]);
      if (empresaIds.length > 0) {
        const valores = empresaIds.map(() => '(?, ?, ?)').join(', ');
        await connection.query(
          `INSERT INTO usuario_empresas (usuario_id, empresa_id, ativo) VALUES ${valores}
           ON CONFLICT (usuario_id, empresa_id) DO UPDATE SET ativo = TRUE`,
          empresaIds.flatMap((empresaId) => [alvoId, empresaId, true])
        );
      }
      await connection.commit();
    } catch (erro) {
      await connection.rollback();
      throw erro;
    } finally {
      connection.release();
    }

    for (const empresaId of removidos) {
      io.in(`usuario_${alvoId}`).socketsLeave(`empresa_${empresaId}`);
    }
    if (alvos[0].role !== 'admin') {
      for (const empresaId of adicionados) {
        io.in(`usuario_${alvoId}`).socketsJoin(`empresa_${empresaId}`);
      }
    }
    await registrarAuditoria(
      req.user!.username,
      'editar',
      'usuario_empresas',
      alvoId,
      `Atualizou empresas do usuário "${alvos[0].username}"`,
      req.ip,
      { usuarioId: req.user!.id }
    );
    res.json({ ok: true, empresa_ids: empresaIds });
  });

  router.delete('/:id', async (req, res) => {
    const alvoId = Number(req.params.id);

    if (alvoId === req.user!.id) {
      return res.status(400).json({ erro: 'Você não pode remover sua própria conta' });
    }

    const [alvoRows]: any = await pool.query(`SELECT username, role, ativo FROM usuarios WHERE id = ?`, [alvoId]);
    const alvo = alvoRows[0];
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado' });

    if (alvo.role === 'admin' && alvo.ativo) {
      const [admins]: any = await pool.query(
        `SELECT COUNT(*) as total FROM usuarios WHERE role = 'admin' AND ativo = TRUE`
      );
      if (admins[0].total <= 1) {
        return res.status(400).json({ erro: 'Não é possível remover o último administrador ativo' });
      }
    }

    await pool.query(
      `UPDATE usuarios SET ativo = FALSE, sessao_versao = sessao_versao + 1 WHERE id = ?`,
      [alvoId]
    );
    io.in(`usuario_${alvoId}`).disconnectSockets(true);
    await registrarAuditoria(
      req.user!.username,
      'remover',
      'usuario',
      alvoId,
      `Desativou usuário "${alvo.username}"`,
      req.ip,
      { usuarioId: req.user!.id }
    );
    res.json({ ok: true });
  });

  router.put('/:id/password', validateBody(redefinirSenhaUsuarioSchema), async (req, res) => {
    const alvoId = Number(req.params.id);
    if (!Number.isInteger(alvoId) || alvoId <= 0) return res.status(400).json({ erro: 'Usuario invalido.' });
    const [alvos]: any = await pool.query(`SELECT username FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1`, [alvoId]);
    if (alvos.length === 0) return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    const hash = await hashPassword(req.body.nova_senha);
    await pool.query(`UPDATE usuarios SET senha_hash = ?, sessao_versao = sessao_versao + 1 WHERE id = ?`, [hash, alvoId]);
    await revogarSessoesUsuario(alvoId);
    io.in(`usuario_${alvoId}`).disconnectSockets(true);
    await registrarAuditoria(
      req.user!.username,
      'senha_redefinida',
      'usuario',
      alvoId,
      `Redefiniu a senha do usuario "${alvos[0].username}"`,
      req.ip,
      { usuarioId: req.user!.id }
    );
    res.json({ ok: true });
  });

  return router;
}
